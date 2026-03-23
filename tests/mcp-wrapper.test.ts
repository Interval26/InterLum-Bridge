import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/server.js";
import type { Server } from "http";
import { BridgeClient } from "../src/mcp-wrapper.js";

const SECRET = "test-secret";
let server: Server;
let port: number;

beforeAll(async () => {
  const app = createApp(SECRET);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      port = (server.address() as any).port;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

describe("BridgeClient", () => {
  it("creates a room and gets a code", async () => {
    const client = new BridgeClient(`http://localhost:${port}`, SECRET);
    const result = await client.createRoom("TestBot");
    expect(result.room_code).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
    expect(result.role).toBe("Claude A");
  });

  it("joins a room", async () => {
    const a = new BridgeClient(`http://localhost:${port}`, SECRET);
    const created = await a.createRoom("Nova");

    const b = new BridgeClient(`http://localhost:${port}`, SECRET);
    const joined = await b.joinRoom(created.room_code, "Atlas");
    expect(joined.role).toBe("Claude B");
  });

  it("sends and receives messages", async () => {
    const a = new BridgeClient(`http://localhost:${port}`, SECRET);
    const created = await a.createRoom("Nova");

    const b = new BridgeClient(`http://localhost:${port}`, SECRET);
    await b.joinRoom(created.room_code, "Atlas");

    await a.checkMessages();
    await b.checkMessages();

    await a.sendMessage("Hello from Nova!");
    const msgs = await b.checkMessages();
    expect(msgs).toContainEqual(
      expect.objectContaining({ from: "Nova", message: "Hello from Nova!" })
    );
  });

  it("disconnects and notifies other side", async () => {
    const a = new BridgeClient(`http://localhost:${port}`, SECRET);
    const created = await a.createRoom("Nova");

    const b = new BridgeClient(`http://localhost:${port}`, SECRET);
    await b.joinRoom(created.room_code, "Atlas");
    await b.checkMessages();

    await a.disconnect();
    const msgs = await b.checkMessages();
    expect(msgs).toContainEqual(
      expect.objectContaining({ from: "system", message: "The other intelligence has left the chat" })
    );
  });
});
