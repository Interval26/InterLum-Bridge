import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Message } from "./types.js";

export class BridgeClient {
  private url: string;
  private secret: string;
  private clientId: string | null = null;
  private roomCode: string | null = null;

  constructor(url: string, secret: string) {
    this.url = url;
    this.secret = secret;
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<any> {
    const res = await globalThis.fetch(`${this.url}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.secret}`,
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any).error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async createRoom(name?: string): Promise<{ room_code: string; client_id: string; role: string }> {
    const result = await this.fetch("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    this.clientId = result.client_id;
    this.roomCode = result.room_code;
    return result;
  }

  async joinRoom(code: string, name?: string): Promise<{ client_id: string; role: string }> {
    const result = await this.fetch(`/api/rooms/${code}/join`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    this.clientId = result.client_id;
    this.roomCode = code;
    return result;
  }

  async sendMessage(message: string): Promise<void> {
    if (!this.roomCode || !this.clientId) throw new Error("Not in a room");
    await this.fetch(`/api/rooms/${this.roomCode}/messages`, {
      method: "POST",
      body: JSON.stringify({ client_id: this.clientId, message }),
    });
  }

  async checkMessages(): Promise<Message[]> {
    if (!this.roomCode || !this.clientId) throw new Error("Not in a room");
    const result = await this.fetch(
      `/api/rooms/${this.roomCode}/messages?client_id=${this.clientId}`
    );
    return result.messages;
  }

  async disconnect(): Promise<void> {
    if (!this.roomCode || !this.clientId) return;
    await this.fetch(`/api/rooms/${this.roomCode}/disconnect`, {
      method: "POST",
      body: JSON.stringify({ client_id: this.clientId }),
    });
    this.roomCode = null;
    this.clientId = null;
  }
}

// MCP Server setup — runs when launched by Claude Desktop
async function main() {
  const bridgeUrl = process.env.BRIDGE_URL || "http://localhost:3000";
  const bridgeSecret = process.env.BRIDGE_SECRET || "";

  if (!bridgeSecret) {
    console.error("BRIDGE_SECRET environment variable is required");
    process.exit(1);
  }

  const client = new BridgeClient(bridgeUrl, bridgeSecret);

  const server = new McpServer({
    name: "claude-chat-bridge",
    version: "1.0.0",
  });

  server.tool(
    "create_room",
    "Create a new chat room on the bridge. Returns a room code to share with the other Claude.",
    { name: z.string().optional().describe("Your display name for the chat") },
    async ({ name }) => {
      try {
        const result = await client.createRoom(name);
        return {
          content: [{ type: "text" as const, text: `Room created! Code: ${result.room_code}\nYour role: ${result.role}\nShare this code with the other Claude to connect.` }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "join_room",
    "Join an existing chat room using a room code.",
    { room_code: z.string().describe("The room code to join"), name: z.string().optional().describe("Your display name for the chat") },
    async ({ room_code, name }) => {
      try {
        const result = await client.joinRoom(room_code, name);
        return {
          content: [{ type: "text" as const, text: `Joined room ${room_code}! Your role: ${result.role}\nYou can now send and receive messages.` }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "send_message",
    "Send a message to the other Claude in your room.",
    { message: z.string().describe("The message to send") },
    async ({ message }) => {
      try {
        await client.sendMessage(message);
        return { content: [{ type: "text" as const, text: "Message sent." }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "check_messages",
    "Check for new messages from the other Claude.",
    {},
    async () => {
      try {
        const messages = await client.checkMessages();
        if (messages.length === 0) {
          return { content: [{ type: "text" as const, text: "No new messages." }] };
        }
        const formatted = messages.map((m) => `[${m.from}]: ${m.message}`).join("\n");
        return { content: [{ type: "text" as const, text: formatted }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "disconnect",
    "Disconnect from the current chat room.",
    {},
    async () => {
      try {
        await client.disconnect();
        return { content: [{ type: "text" as const, text: "Disconnected from the room." }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run MCP server when executed directly
const isMain = process.argv[1] && import.meta.url.includes(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  main().catch(console.error);
}
