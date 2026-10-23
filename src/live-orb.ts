import type { LiveStripMode } from "./live-strip";
import { InputLevelNormalizer } from "./live-orb-level";

const VERTEX_SHADER = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// Fluid bands: white top, pale tint middle, accent bottom, warped by fbm.
// Output is premultiplied so the canvas edge blends into any strip surface.
const FRAGMENT_SHADER = `
precision mediump float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uLevel;
uniform float uMono;
uniform float uGather;
uniform vec3 uColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  float side = min(uResolution.x, uResolution.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / side;
  float radius = 0.44 + uLevel * 0.05 - uGather * 0.05;
  float edge = 1.5 / side;
  float mask = 1.0 - smoothstep(radius - edge, radius, length(uv));
  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec2 p = uv / radius;
  float t = uTime;
  vec2 q = vec2(
    fbm(p * 1.3 + vec2(t * 0.20, -t * 0.15)),
    fbm(p * 1.3 + vec2(-t * 0.17, t * 0.22) + 4.0)
  );
  float n = fbm(p * 1.6 + q * (1.1 + uLevel * 1.8) + vec2(0.0, t * 0.1));
  float band = (p.y * 0.5 + 0.5) + (n - 0.5) * (0.9 + uLevel * 0.7);
  vec3 pale = mix(uColor, vec3(1.0), 0.62);
  vec3 color = mix(uColor, pale, smoothstep(0.18, 0.5, band));
  color = mix(color, vec3(1.0), smoothstep(0.55, 0.85, band));
  color *= 1.0 - 0.18 * smoothstep(0.6, 1.0, length(p));
  float gray = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, vec3(gray), uMono);
  gl_FragColor = vec4(color * mask, mask);
}
`;

// Fallback when layout has no size yet; CSS sets the real one per platform.
const ORB_SIZE = 32;

interface OrbTargets {
  mono: number;
  gather: number;
}

function targetsFor(mode: LiveStripMode): OrbTargets {
  if (mode === "connecting") return { mono: 1, gather: 0 };
  if (mode === "finishing") return { mono: 0.35, gather: 1 };
  return { mono: 0, gather: 0 };
}

function parseRgb(value: string): [number, number, number] | null {
  const match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (!match) return null;
  return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255];
}

function compile(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export class CrispAsrLiveOrb {
  private readonly view: Window | null;
  private gl: WebGLRenderingContext | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private frame = 0;
  private lastFrameAt = 0;
  private time = Math.random() * 40;
  private level = 0;
  private targetLevel = 0;
  private readonly normalizer = new InputLevelNormalizer();
  private mono = 1;
  private gather = 0;
  private targets: OrbTargets = targetsFor("connecting");
  private color: [number, number, number] = [0.1, 0.45, 0.95];
  private readonly reducedMotion: boolean;
  private onLost: (() => void) | null = null;

  private constructor(private readonly canvas: HTMLCanvasElement) {
    this.view = canvas.ownerDocument.defaultView;
    this.reducedMotion = this.view?.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches ?? false;
  }

  /**
   * Returns null when WebGL is unavailable; the caller keeps the CSS dot.
   * `onLost` runs once if the GPU context is lost later; the orb has removed itself by then.
   */
  static mount(host: HTMLElement, onLost?: () => void): CrispAsrLiveOrb | null {
    const canvas = host.ownerDocument.createElement("canvas");
    canvas.className = "crisp-asr-live-strip__orb";
    canvas.setAttribute("aria-hidden", "true");
    const orb = new CrispAsrLiveOrb(canvas);
    // Attach first so the backing store can match the CSS size.
    host.append(canvas);
    if (!orb.init()) {
      canvas.remove();
      return null;
    }
    host.ownerDocument.addEventListener("visibilitychange", orb.onVisibility);
    orb.onLost = onLost ?? null;
    canvas.addEventListener("webglcontextlost", orb.onContextLost);
    return orb;
  }

  update(mode: LiveStripMode, level: number): void {
    this.targets = targetsFor(mode);
    const normalized = this.normalizer.push(
      level,
      this.view?.performance.now() ?? Date.now(),
    );
    this.targetLevel = mode === "listening" ? normalized : 0;
    this.readColor();
    this.start();
  }

  destroy(): void {
    // loseContext() below fires webglcontextlost; that is not a GPU failure.
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.onLost = null;
    this.stop();
    this.canvas.ownerDocument.removeEventListener(
      "visibilitychange",
      this.onVisibility,
    );
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
    this.canvas.remove();
  }

  private init(): boolean {
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = this.canvas.getContext("webgl", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: "low-power",
      });
    } catch {
      return false;
    }
    if (!gl) return false;
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return false;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    for (const name of ["uResolution", "uTime", "uLevel", "uMono", "uGather", "uColor"]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    const ratio = Math.min(2, this.view?.devicePixelRatio || 1);
    const size = this.canvas.clientWidth || ORB_SIZE;
    this.canvas.width = Math.round(size * ratio);
    this.canvas.height = Math.round(size * ratio);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    this.gl = gl;
    return true;
  }

  private readColor(): void {
    if (!this.canvas.isConnected || !this.view) return;
    const rgb = parseRgb(this.view.getComputedStyle(this.canvas).color);
    if (rgb) this.color = rgb;
  }

  private start(): void {
    if (this.frame || !this.gl || !this.view) return;
    if (this.canvas.ownerDocument.hidden) return;
    if (this.reducedMotion) {
      this.mono = this.targets.mono;
      this.gather = this.targets.gather;
      this.draw();
      return;
    }
    this.lastFrameAt = 0;
    this.frame = this.view.requestAnimationFrame(this.tick);
  }

  private stop(): void {
    if (this.frame) this.view?.cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private readonly onContextLost = (): void => {
    const onLost = this.onLost;
    this.destroy();
    onLost?.();
  };

  private readonly onVisibility = (): void => {
    if (this.canvas.ownerDocument.hidden) this.stop();
    else this.start();
  };

  private readonly tick = (now: number): void => {
    this.frame = 0;
    if (!this.gl || !this.view) return;
    const dt = this.lastFrameAt ? Math.min(0.05, (now - this.lastFrameAt) / 1000) : 0;
    this.lastFrameAt = now;
    const ease = 1 - Math.exp(-dt * 6);
    this.level += (this.targetLevel - this.level) * (1 - Math.exp(-dt * 10));
    this.mono += (this.targets.mono - this.mono) * ease;
    this.gather += (this.targets.gather - this.gather) * ease;
    // Speed is integrated so a louder voice accelerates without jumping.
    this.time += dt * (0.35 + this.level * 1.8 - this.gather * 0.2);
    this.draw();
    this.frame = this.view.requestAnimationFrame(this.tick);
  };

  private draw(): void {
    const gl = this.gl;
    if (!gl) return;
    gl.uniform2f(this.uniforms.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.uTime, this.time);
    gl.uniform1f(this.uniforms.uLevel, this.level);
    gl.uniform1f(this.uniforms.uMono, this.mono);
    gl.uniform1f(this.uniforms.uGather, this.gather);
    gl.uniform3f(this.uniforms.uColor, ...this.color);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
