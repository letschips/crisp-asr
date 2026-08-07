export interface MicrophoneDevice {
  deviceId: string;
  label: string;
}

interface DeviceInfoLike {
  kind: string;
  deviceId: string;
  label: string;
}

export interface AudioMediaDevices {
  enumerateDevices?: () => Promise<DeviceInfoLike[]>;
  getUserMedia?: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>;
}

export interface MicrophoneChangeSource {
  addEventListener?: (
    type: "devicechange",
    listener: () => void,
  ) => void;
  removeEventListener?: (
    type: "devicechange",
    listener: () => void,
  ) => void;
}

export interface AcquiredAudioInputs {
  audioStreams: MediaStream[];
  stop: () => void;
}

export function subscribeToMicrophoneChanges(
  source: MicrophoneChangeSource,
  onChange: () => void,
): () => void {
  if (!source.addEventListener || !source.removeEventListener) {
    return () => undefined;
  }
  source.addEventListener("devicechange", onChange);
  return () => {
    source.removeEventListener?.("devicechange", onChange);
  };
}

export async function listMicrophoneDevices(
  mediaDevices: Pick<AudioMediaDevices, "enumerateDevices">,
): Promise<MicrophoneDevice[]> {
  const entries = await mediaDevices.enumerateDevices?.() ?? [];
  const microphones = entries.filter((entry) =>
    entry.kind === "audioinput" && entry.deviceId !== "default"
  );
  return [
    { deviceId: "default", label: "系统默认" },
    ...microphones.map((entry, index) => ({
      deviceId: entry.deviceId,
      label: entry.label.trim() || `麦克风 ${index + 1}`,
    })),
  ];
}

export function resolveMicrophoneDeviceId(
  savedDeviceId: string,
  devices: MicrophoneDevice[],
): string {
  return devices.some((device) => device.deviceId === savedDeviceId)
    ? savedDeviceId
    : "default";
}

export function preservePreferredMicrophone(
  devices: MicrophoneDevice[],
  preferredDeviceId: string,
): MicrophoneDevice[] {
  if (
    preferredDeviceId === "default"
    || devices.some((device) => device.deviceId === preferredDeviceId)
  ) {
    return devices;
  }
  return [
    ...devices,
    {
      deviceId: preferredDeviceId,
      label: "已选麦克风（刷新后显示名称）",
    },
  ];
}

function microphoneConstraints(deviceId: string): MediaTrackConstraints {
  return {
    ...(deviceId !== "default"
      ? { deviceId: { exact: deviceId } }
      : {}),
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

function missingSelectedDevice(error: unknown): boolean {
  return error instanceof DOMException
    && (error.name === "OverconstrainedError" || error.name === "NotFoundError");
}

function stopStreams(streams: MediaStream[]): void {
  const stopped = new Set<MediaStreamTrack>();
  for (const stream of streams) {
    for (const track of stream.getTracks()) {
      if (!stopped.has(track)) {
        stopped.add(track);
        track.stop();
      }
    }
  }
}

export async function acquireAudioInputs(
  mediaDevices: AudioMediaDevices,
  microphoneDeviceId: string,
  onInputEnded: () => void,
): Promise<AcquiredAudioInputs> {
  const acquired: MediaStream[] = [];
  try {
    if (!mediaDevices.getUserMedia) {
      throw new Error("当前环境无法访问麦克风");
    }
    let microphone: MediaStream;
    try {
      microphone = await mediaDevices.getUserMedia({
        audio: microphoneConstraints(microphoneDeviceId),
      });
    } catch (error) {
      if (
        microphoneDeviceId === "default"
        || !missingSelectedDevice(error)
      ) {
        throw error;
      }
      microphone = await mediaDevices.getUserMedia({
        audio: microphoneConstraints("default"),
      });
    }
    acquired.push(microphone);
  } catch (error) {
    stopStreams(acquired);
    throw error;
  }

  let stopped = false;
  let ended = false;
  const tracks = acquired.flatMap((stream) => stream.getTracks());
  const handleEnded = (): void => {
    if (stopped || ended) {
      return;
    }
    ended = true;
    onInputEnded();
  };
  for (const track of tracks) {
    track.addEventListener("ended", handleEnded);
  }

  return {
    audioStreams: acquired,
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      for (const track of tracks) {
        track.removeEventListener("ended", handleEnded);
      }
      stopStreams(acquired);
    },
  };
}
