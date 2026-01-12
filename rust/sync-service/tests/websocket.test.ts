import { Miniflare } from "miniflare";
import { test, describe, beforeEach, expect } from "vitest";
import { connectToDocumentForTesting, setupMiniflare } from "./utils";

let mf: Miniflare;

beforeEach(async () => {
  mf = await setupMiniflare();
});

describe("websocket tests", async () => {
  test("should respond to ping with pong", async () => {

    const ws = await connectToDocumentForTesting(mf, "test-ping");

    // drain the initial sync message
    await ws.waitForNextMessage();

    ws.send("ping");

    let maybePong = await ws.waitForNextMessage();

    expect(maybePong.toString().trim()).toBe("pong");
  });
});
