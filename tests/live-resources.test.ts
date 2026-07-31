import { describe, expect, it } from "vitest";
import { abortLiveResources } from "../src/live-resources";

describe("live resource cleanup", () => {
  it("closes the socket before stopping capture and tolerates capture flush errors", async () => {
    let socketClosed = false;
    let captureSawClosedSocket = false;

    await expect(abortLiveResources({
      client: {
        close: () => {
          socketClosed = true;
        },
      },
      capture: {
        stop: async () => {
          captureSawClosedSocket = socketClosed;
          throw new Error("final packet cannot be sent");
        },
      },
    })).resolves.toBeUndefined();

    expect(socketClosed).toBe(true);
    expect(captureSawClosedSocket).toBe(true);
  });
});
