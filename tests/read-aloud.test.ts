import { describe, expect, it } from "vitest";
import { ReadAloudSession, type AudioSink, type ReadAloudStatus } from "../src/read-aloud";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const buf = (label: string) => new TextEncoder().encode(label).buffer as ArrayBuffer;
const label = (audio: ArrayBuffer) => new TextDecoder().decode(audio);

class FakeSink implements AudioSink {
  played: string[] = [];
  current: ReturnType<typeof deferred<void>> | null = null;
  play(audio: ArrayBuffer): Promise<void> {
    this.played.push(label(audio));
    this.current = deferred<void>();
    return this.current.promise;
  }
  finish() { this.current?.resolve(); }
  pause() {}
  resume() {}
  stop() { this.current?.resolve(); }
}

function setup(chunks: string[], prefetch = 1) {
  const requests = new Map<string, ReturnType<typeof deferred<ArrayBuffer>>>();
  const calls: string[] = [];
  const statuses: ReadAloudStatus[] = [];
  const sink = new FakeSink();
  const session = new ReadAloudSession(chunks, {
    synthesize: (text) => {
      calls.push(text);
      const d = deferred<ArrayBuffer>();
      requests.set(text, d);
      return d.promise;
    },
    sink,
    onStatus: (s) => statuses.push(s),
    prefetch,
  });
  return { session, requests, calls, statuses, sink };
}

describe("ReadAloudSession", () => {
  it("plays in document order even when a later chunk finishes synthesizing first", async () => {
    const { session, requests, sink } = setup(["a", "b"]);
    const done = session.run();
    await tick();
    requests.get("b")!.resolve(buf("b"));
    await tick();
    expect(sink.played).toEqual([]);
    requests.get("a")!.resolve(buf("a"));
    await tick();
    expect(sink.played).toEqual(["a"]);
    sink.finish();
    await tick();
    expect(sink.played).toEqual(["a", "b"]);
    sink.finish();
    await done;
    expect(session.status.state).toBe("finished");
  });

  it("bounds prefetch so a long document is not synthesized all at once", async () => {
    const { session, calls } = setup(["a", "b", "c", "d", "e"], 1);
    void session.run();
    await tick();
    expect(calls).toEqual(["a", "b"]);
    session.stop();
  });

  it("stop while loading prevents any later playback", async () => {
    const { session, requests, sink } = setup(["a", "b"]);
    const done = session.run();
    await tick();
    session.stop();
    requests.get("a")!.resolve(buf("a"));
    await done;
    expect(sink.played).toEqual([]);
    expect(session.status.state).toBe("stopped");
  });

  it("a synthesis failure stops the session and reports the error", async () => {
    const { session, requests, sink } = setup(["a", "b"]);
    const done = session.run();
    await tick();
    requests.get("b")!.resolve(buf("b"));
    requests.get("a")!.reject(new Error("quota"));
    await done;
    expect(sink.played).toEqual([]);
    expect(session.status.state).toBe("failed");
    expect(session.status.error).toContain("quota");
  });

  it("pause before audio arrives holds playback until resume", async () => {
    const { session, requests, sink } = setup(["a"]);
    const done = session.run();
    await tick();
    session.pause();
    requests.get("a")!.resolve(buf("a"));
    await tick();
    expect(sink.played).toEqual([]);
    expect(session.status.state).toBe("paused");
    session.resume();
    await tick();
    expect(sink.played).toEqual(["a"]);
    sink.finish();
    await done;
  });
});
