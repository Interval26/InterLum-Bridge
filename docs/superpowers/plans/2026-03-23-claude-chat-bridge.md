# Claude Chat Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server + bridge that lets two Claude Desktop instances chat with each other, monitored via a terminal-style web dashboard.

**Architecture:** A shared Express HTTP server manages rooms and messages, serving both a REST API and a monitoring dashboard. Thin MCP stdio wrappers (one per Claude Desktop instance) connect to the server and expose 5 tools: create_room, join_room, send_message, check_messages, disconnect. A vanilla JS dashboard connects via SSE for real-time transcript viewing.

**Tech Stack:** Node.js, TypeScript, Express, @modelcontextprotocol/sdk, dotenv, vitest

---

## File Structure

```
claude-chat-bridge/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── types.ts            # Shared TypeScript types (Room, Client, Message)
│   ├── room-codes.ts       # adjective-noun-number room code generator
│   ├── room-manager.ts     # In-memory room state: create, join, message, disconnect, cleanup
│   ├── auth.ts             # Express middleware: Bearer token check against BRIDGE_SECRET
│   ├── server.ts           # Express app: REST API, SSE, serves dashboard, starts HTTP server
│   └── mcp-wrapper.ts      # MCP stdio server: exposes 5 tools, HTTP client to bridge server
├── dashboard/
│   ├── index.html          # Login screen + dashboard layout
│   ├── style.css           # Terminal-style dark theme
│   └── app.js              # Client-side JS: auth, room list, transcript, SSE, controls
└── tests/
    ├── room-codes.test.ts  # Code format, uniqueness
    ├── room-manager.test.ts # Room lifecycle, messaging, cleanup
    ├── auth.test.ts        # Middleware allows/blocks requests
    ├── api.test.ts         # REST endpoint integration tests
    └── mcp-wrapper.test.ts # MCP tool call tests
```

---

### Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `src/types.ts`

- [ ] **Step 1: Initialize npm project**

Run: `cd C:/Users/aiint/Downloads/claude-chat-bridge && npm init -y`

- [ ] **Step 2: Install dependencies**

Run: `npm install express dotenv @modelcontextprotocol/sdk uuid zod`
Run: `npm install -D typescript @types/express @types/node @types/uuid vitest tsx`

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create .env.example**

```
BRIDGE_SECRET=change-me-to-a-real-secret
```

- [ ] **Step 5: Create src/types.ts**

```typescript
export interface Message {
  from: string;       // client name, or "system"
  message: string;
  timestamp: number;  // Date.now()
}

export interface Client {
  id: string;         // UUID
  name: string;       // display name (e.g., "Nova") or default "Claude A"/"Claude B"
  role: "Claude A" | "Claude B";
  lastPoll: number;   // Date.now() of last check_messages
}

export interface Room {
  code: string;
  clients: Client[];
  messages: Message[];
  paused: boolean;
  createdAt: number;
}
```

- [ ] **Step 6: Add scripts to package.json**

Add to `package.json` scripts:
```json
{
  "scripts": {
    "build": "tsc",
    "start": "tsx src/server.ts",
    "mcp": "tsx src/mcp-wrapper.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json .env.example src/types.ts package-lock.json
git commit -m "feat: project setup with dependencies and shared types"
```

---

### Task 2: Room Code Generator

**Files:**
- Create: `src/room-codes.ts`
- Create: `tests/room-codes.test.ts`

- [ ] **Step 1: Write failing tests for room code generation**

Create `tests/room-codes.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateRoomCode } from "../src/room-codes.js";

describe("generateRoomCode", () => {
  it("returns a string in adjective-noun-number format", () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
  });

  it("generates different codes on successive calls", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateRoomCode()));
    expect(codes.size).toBeGreaterThan(15);
  });

  it("can accept a Set of existing codes and avoids collisions", () => {
    const existing = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode(existing);
      expect(existing.has(code)).toBe(false);
      existing.add(code);
    }
    expect(existing.size).toBe(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/room-codes.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement room code generator**

Create `src/room-codes.ts`:

```typescript
const ADJECTIVES = [
  "swift", "calm", "bold", "warm", "cool", "bright", "dark", "keen",
  "wild", "soft", "deep", "fair", "free", "glad", "gold", "kind",
  "lean", "mild", "neat", "pale", "pure", "rare", "rich", "safe",
  "tall", "true", "vast", "wise", "aged", "blue", "cold", "crisp",
  "dry", "fast", "fine", "firm", "flat", "full", "gray", "green",
  "high", "late", "long", "lost", "new", "odd", "old", "raw",
  "red", "shy"
];

const NOUNS = [
  "owl", "fox", "wolf", "bear", "hawk", "deer", "hare", "lynx",
  "crow", "dove", "swan", "frog", "moth", "wasp", "crab", "fish",
  "seal", "wren", "lark", "mole", "newt", "pike", "ram", "tern",
  "vole", "yak", "ibis", "kite", "lion", "puma", "rook", "stag",
  "toad", "orca", "ray", "bee", "ant", "elk", "emu", "gnu",
  "jay", "cod", "asp", "bat", "cat", "dog", "hen", "pig",
  "rat", "tiger"
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateRoomCode(existing?: Set<string>): string {
  const maxAttempts = 100;
  for (let i = 0; i < maxAttempts; i++) {
    const adj = pick(ADJECTIVES);
    const noun = pick(NOUNS);
    const num = String(Math.floor(Math.random() * 100)).padStart(2, "0");
    const code = `${adj}-${noun}-${num}`;
    if (!existing || !existing.has(code)) {
      return code;
    }
  }
  throw new Error("Failed to generate unique room code after 100 attempts");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/room-codes.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/room-codes.ts tests/room-codes.test.ts
git commit -m "feat: room code generator with adjective-noun-number format"
```

---

### Task 3: Room Manager

**Files:**
- Create: `src/room-manager.ts`
- Create: `tests/room-manager.test.ts`

- [ ] **Step 1: Write failing tests for room lifecycle**

Create `tests/room-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { RoomManager } from "../src/room-manager.js";

describe("RoomManager", () => {
  let rm: RoomManager;

  beforeEach(() => {
    rm = new RoomManager();
  });

  describe("createRoom", () => {
    it("creates a room and returns code, client_id, role", () => {
      const result = rm.createRoom("Nova");
      expect(result.room_code).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
      expect(result.client_id).toBeTruthy();
      expect(result.role).toBe("Claude A");
    });

    it("uses default name when none provided", () => {
      const result = rm.createRoom();
      const room = rm.getRoom(result.room_code);
      expect(room!.clients[0].name).toBe("Claude A");
    });
  });

  describe("joinRoom", () => {
    it("joins an existing room", () => {
      const created = rm.createRoom("Nova");
      const joined = rm.joinRoom(created.room_code, "Atlas");
      expect(joined.client_id).toBeTruthy();
      expect(joined.role).toBe("Claude B");
    });

    it("throws on invalid room code", () => {
      expect(() => rm.joinRoom("bad-code-00")).toThrow("No room found with that code");
    });

    it("throws when room is full", () => {
      const created = rm.createRoom();
      rm.joinRoom(created.room_code);
      expect(() => rm.joinRoom(created.room_code)).toThrow("Room is full");
    });

    it("queues a system message when second client joins", () => {
      const created = rm.createRoom("Nova");
      rm.joinRoom(created.room_code, "Atlas");
      const msgs = rm.getMessages(created.room_code, created.client_id);
      expect(msgs).toContainEqual(
        expect.objectContaining({ from: "system", message: "Another intelligence has joined the chat" })
      );
    });
  });

  describe("sendMessage", () => {
    it("delivers a message to the other client", () => {
      const a = rm.createRoom("Nova");
      const b = rm.joinRoom(a.room_code, "Atlas");
      // drain join notification
      rm.getMessages(a.room_code, a.client_id);
      rm.getMessages(a.room_code, b.client_id);

      rm.sendMessage(a.room_code, a.client_id, "Hello!");
      const msgs = rm.getMessages(a.room_code, b.client_id);
      expect(msgs).toEqual([
        expect.objectContaining({ from: "Nova", message: "Hello!" })
      ]);
    });

    it("throws when not in a room", () => {
      expect(() => rm.sendMessage("bad-code-00", "bad-id", "hi")).toThrow();
    });

    it("throws when room has only one client", () => {
      const a = rm.createRoom();
      expect(() => rm.sendMessage(a.room_code, a.client_id, "hi"))
        .toThrow("No other intelligence in the room yet");
    });
  });

  describe("disconnect", () => {
    it("notifies the other client", () => {
      const a = rm.createRoom("Nova");
      const b = rm.joinRoom(a.room_code, "Atlas");
      rm.getMessages(a.room_code, b.client_id); // drain

      rm.disconnect(a.room_code, a.client_id);
      const msgs = rm.getMessages(a.room_code, b.client_id);
      expect(msgs).toContainEqual(
        expect.objectContaining({ from: "system", message: "The other intelligence has left the chat" })
      );
    });
  });

  describe("pause/resume", () => {
    it("holds messages when paused", () => {
      const a = rm.createRoom("Nova");
      const b = rm.joinRoom(a.room_code, "Atlas");
      rm.getMessages(a.room_code, b.client_id); // drain

      rm.pauseRoom(a.room_code);
      rm.sendMessage(a.room_code, a.client_id, "held message");
      const msgs = rm.getMessages(a.room_code, b.client_id);
      expect(msgs).toEqual([]);
    });

    it("releases held messages on resume", () => {
      const a = rm.createRoom("Nova");
      const b = rm.joinRoom(a.room_code, "Atlas");
      rm.getMessages(a.room_code, b.client_id); // drain

      rm.pauseRoom(a.room_code);
      rm.sendMessage(a.room_code, a.client_id, "held message");
      rm.resumeRoom(a.room_code);
      const msgs = rm.getMessages(a.room_code, b.client_id);
      expect(msgs).toContainEqual(
        expect.objectContaining({ message: "held message" })
      );
    });
  });

  describe("listRooms", () => {
    it("returns all rooms with status info", () => {
      rm.createRoom("Nova");
      const rooms = rm.listRooms();
      expect(rooms).toHaveLength(1);
      expect(rooms[0]).toHaveProperty("code");
      expect(rooms[0]).toHaveProperty("connectedCount", 1);
    });
  });

  describe("cleanup", () => {
    it("removes rooms with zero clients after timeout", () => {
      const a = rm.createRoom();
      rm.disconnect(a.room_code, a.client_id);
      // Simulate time passing by directly calling cleanup with 0 timeout
      rm.cleanupRooms(0);
      expect(rm.getRoom(a.room_code)).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/room-manager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement RoomManager**

Create `src/room-manager.ts`:

```typescript
import { v4 as uuidv4 } from "uuid";
import { generateRoomCode } from "./room-codes.js";
import type { Room, Client, Message } from "./types.js";

interface UnreadTracker {
  [clientId: string]: Message[];
}

interface RoomInternal extends Room {
  unread: UnreadTracker;
  heldMessages: Message[];  // messages held during pause
  disconnectedAt: number | null;
}

export interface RoomSummary {
  code: string;
  connectedCount: number;
  messageCount: number;
  clientNames: string[];
  paused: boolean;
  status: "active" | "waiting" | "ended";
}

export class RoomManager {
  private rooms = new Map<string, RoomInternal>();
  private existingCodes = new Set<string>();
  private eventListeners = new Map<string, Array<(event: string, data: unknown) => void>>();

  createRoom(name?: string): { room_code: string; client_id: string; role: "Claude A" } {
    const code = generateRoomCode(this.existingCodes);
    this.existingCodes.add(code);

    const clientId = uuidv4();
    const client: Client = {
      id: clientId,
      name: name || "Claude A",
      role: "Claude A",
      lastPoll: Date.now(),
    };

    const room: RoomInternal = {
      code,
      clients: [client],
      messages: [],
      paused: false,
      createdAt: Date.now(),
      unread: { [clientId]: [] },
      heldMessages: [],
      disconnectedAt: null,
    };

    this.rooms.set(code, room);
    this.emit(code, "room-created", { code });

    return { room_code: code, client_id: clientId, role: "Claude A" };
  }

  joinRoom(code: string, name?: string): { client_id: string; role: "Claude B" } {
    const room = this.rooms.get(code);
    if (!room) throw new Error("No room found with that code");
    if (room.clients.length >= 2) throw new Error("Room is full");

    const clientId = uuidv4();
    const client: Client = {
      id: clientId,
      name: name || "Claude B",
      role: "Claude B",
      lastPoll: Date.now(),
    };

    room.clients.push(client);
    room.unread[clientId] = [];

    const joinMsg: Message = {
      from: "system",
      message: "Another intelligence has joined the chat",
      timestamp: Date.now(),
    };

    room.messages.push(joinMsg);
    // Notify all existing clients
    for (const c of room.clients) {
      room.unread[c.id].push(joinMsg);
    }

    this.emit(code, "client-joined", { name: client.name, role: client.role });
    this.emit(code, "message", joinMsg);

    return { client_id: clientId, role: "Claude B" };
  }

  sendMessage(code: string, clientId: string, message: string): void {
    const room = this.rooms.get(code);
    if (!room) throw new Error("No room found with that code");

    const sender = room.clients.find((c) => c.id === clientId);
    if (!sender) throw new Error("Not in this room");
    if (room.clients.length < 2) throw new Error("No other intelligence in the room yet");

    const otherClient = room.clients.find((c) => c.id !== clientId);
    if (!otherClient) throw new Error("The other intelligence has disconnected");

    const msg: Message = {
      from: sender.name,
      message,
      timestamp: Date.now(),
    };

    room.messages.push(msg);

    if (room.paused) {
      room.heldMessages.push(msg);
    } else {
      // Deliver to the other client only
      room.unread[otherClient.id].push(msg);
    }

    this.emit(code, "message", msg);
  }

  getMessages(code: string, clientId: string): Message[] {
    const room = this.rooms.get(code);
    if (!room) throw new Error("No room found with that code");

    const client = room.clients.find((c) => c.id === clientId);
    if (!client) throw new Error("Not in this room");

    client.lastPoll = Date.now();
    const msgs = room.unread[clientId] || [];
    room.unread[clientId] = [];
    return msgs;
  }

  disconnect(code: string, clientId: string): void {
    const room = this.rooms.get(code);
    if (!room) return;

    room.clients = room.clients.filter((c) => c.id !== clientId);
    delete room.unread[clientId];

    const msg: Message = {
      from: "system",
      message: "The other intelligence has left the chat",
      timestamp: Date.now(),
    };

    room.messages.push(msg);
    for (const c of room.clients) {
      room.unread[c.id].push(msg);
    }

    if (room.clients.length === 0) {
      room.disconnectedAt = Date.now();
    }

    this.emit(code, "message", msg);
    this.emit(code, "client-left", { clientId });
  }

  disconnectAll(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;

    const msg: Message = {
      from: "system",
      message: "The other intelligence has left the chat",
      timestamp: Date.now(),
    };

    room.messages.push(msg);
    room.clients = [];
    room.unread = {};
    room.disconnectedAt = Date.now();

    this.emit(code, "message", msg);
    this.emit(code, "disconnect-all", {});
  }

  pauseRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) throw new Error("No room found with that code");
    room.paused = true;
    this.emit(code, "paused", {});
  }

  resumeRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) throw new Error("No room found with that code");
    room.paused = false;

    // Deliver held messages
    for (const msg of room.heldMessages) {
      for (const c of room.clients) {
        const sender = room.clients.find(
          (cl) => cl.name === msg.from
        );
        if (!sender || sender.id !== c.id) {
          room.unread[c.id].push(msg);
        }
      }
    }
    room.heldMessages = [];

    this.emit(code, "resumed", {});
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  getTranscript(code: string): Message[] {
    const room = this.rooms.get(code);
    if (!room) throw new Error("No room found with that code");
    return [...room.messages];
  }

  getRoomStatus(code: string): {
    connectedCount: number;
    messageCount: number;
    clients: Array<{ name: string; role: string; connected: boolean }>;
    paused: boolean;
  } {
    const room = this.rooms.get(code);
    if (!room) throw new Error("No room found with that code");
    return {
      connectedCount: room.clients.length,
      messageCount: room.messages.length,
      clients: room.clients.map((c) => ({
        name: c.name,
        role: c.role,
        connected: true,
      })),
      paused: room.paused,
    };
  }

  listRooms(): RoomSummary[] {
    return Array.from(this.rooms.values()).map((room) => ({
      code: room.code,
      connectedCount: room.clients.length,
      messageCount: room.messages.length,
      clientNames: room.clients.map((c) => c.name),
      paused: room.paused,
      status:
        room.clients.length === 2
          ? "active"
          : room.clients.length === 1
            ? "waiting"
            : "ended",
    }));
  }

  cleanupStaleClients(staleMs: number = 5 * 60 * 1000): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const staleClients = room.clients.filter((c) => now - c.lastPoll >= staleMs);
      for (const client of staleClients) {
        this.disconnect(code, client.id);
      }
    }
  }

  cleanupRooms(timeoutMs: number = 10 * 60 * 1000): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (
        room.clients.length === 0 &&
        room.disconnectedAt !== null &&
        now - room.disconnectedAt >= timeoutMs
      ) {
        this.rooms.delete(code);
        this.existingCodes.delete(code);
      }
    }
  }

  // SSE event system
  onRoomEvent(code: string, listener: (event: string, data: unknown) => void): () => void {
    if (!this.eventListeners.has(code)) {
      this.eventListeners.set(code, []);
    }
    this.eventListeners.get(code)!.push(listener);

    return () => {
      const listeners = this.eventListeners.get(code);
      if (listeners) {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      }
    };
  }

  private emit(code: string, event: string, data: unknown): void {
    const listeners = this.eventListeners.get(code);
    if (listeners) {
      for (const listener of listeners) {
        listener(event, data);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/room-manager.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/room-manager.ts tests/room-manager.test.ts
git commit -m "feat: room manager with create, join, message, disconnect, pause/resume"
```

---

### Task 4: Auth Middleware

**Files:**
- Create: `src/auth.ts`
- Create: `tests/auth.test.ts`

- [ ] **Step 1: Write failing tests for auth middleware**

Create `tests/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAuthMiddleware } from "../src/auth.js";
import type { Request, Response, NextFunction } from "express";

function mockReqResNext(authHeader?: string) {
  const req = { headers: { authorization: authHeader } } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe("createAuthMiddleware", () => {
  const middleware = createAuthMiddleware("test-secret");

  it("calls next() when Bearer token matches", () => {
    const { req, res, next } = mockReqResNext("Bearer test-secret");
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("returns 401 when no auth header", () => {
    const { req, res, next } = mockReqResNext(undefined);
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when token is wrong", () => {
    const { req, res, next } = mockReqResNext("Bearer wrong-secret");
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 when format is not Bearer", () => {
    const { req, res, next } = mockReqResNext("Basic test-secret");
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/auth.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement auth middleware**

Create `src/auth.ts`:

```typescript
import type { Request, Response, NextFunction } from "express";

export function createAuthMiddleware(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.slice(7) !== secret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/auth.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts tests/auth.test.ts
git commit -m "feat: Bearer token auth middleware"
```

---

### Task 5: Bridge Server REST API

**Files:**
- Create: `src/server.ts`
- Create: `tests/api.test.ts`

- [ ] **Step 1: Write failing tests for API endpoints**

Create `tests/api.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";

// npm install -D supertest @types/supertest (add this dependency first)

const SECRET = "test-secret";
const AUTH = { Authorization: `Bearer ${SECRET}` };

describe("API", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp(SECRET);
  });

  describe("POST /api/rooms", () => {
    it("creates a room", async () => {
      const res = await request(app).post("/api/rooms").set(AUTH).send({ name: "Nova" });
      expect(res.status).toBe(200);
      expect(res.body.room_code).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
      expect(res.body.client_id).toBeTruthy();
      expect(res.body.role).toBe("Claude A");
    });

    it("returns 401 without auth", async () => {
      const res = await request(app).post("/api/rooms").send({});
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/rooms/:code/join", () => {
    it("joins an existing room", async () => {
      const create = await request(app).post("/api/rooms").set(AUTH).send({ name: "Nova" });
      const res = await request(app)
        .post(`/api/rooms/${create.body.room_code}/join`)
        .set(AUTH)
        .send({ name: "Atlas" });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("Claude B");
    });

    it("returns 404 for invalid code", async () => {
      const res = await request(app)
        .post("/api/rooms/bad-code-00/join")
        .set(AUTH)
        .send({});
      expect(res.status).toBe(404);
    });
  });

  describe("messaging", () => {
    it("sends and receives messages", async () => {
      const a = await request(app).post("/api/rooms").set(AUTH).send({ name: "Nova" });
      const code = a.body.room_code;
      const b = await request(app).post(`/api/rooms/${code}/join`).set(AUTH).send({ name: "Atlas" });

      // Drain join notifications
      await request(app).get(`/api/rooms/${code}/messages?client_id=${a.body.client_id}`).set(AUTH);
      await request(app).get(`/api/rooms/${code}/messages?client_id=${b.body.client_id}`).set(AUTH);

      // Send message from A
      await request(app)
        .post(`/api/rooms/${code}/messages`)
        .set(AUTH)
        .send({ client_id: a.body.client_id, message: "Hello!" });

      // B receives it
      const msgs = await request(app)
        .get(`/api/rooms/${code}/messages?client_id=${b.body.client_id}`)
        .set(AUTH);
      expect(msgs.body.messages).toEqual([
        expect.objectContaining({ from: "Nova", message: "Hello!" }),
      ]);
    });
  });

  describe("GET /api/rooms", () => {
    it("lists rooms", async () => {
      await request(app).post("/api/rooms").set(AUTH).send({});
      const res = await request(app).get("/api/rooms").set(AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe("dashboard controls", () => {
    it("pauses and resumes a room", async () => {
      const a = await request(app).post("/api/rooms").set(AUTH).send({ name: "Nova" });
      const code = a.body.room_code;
      const b = await request(app).post(`/api/rooms/${code}/join`).set(AUTH).send({ name: "Atlas" });
      await request(app).get(`/api/rooms/${code}/messages?client_id=${b.body.client_id}`).set(AUTH);

      // Pause
      await request(app).post(`/api/rooms/${code}/pause`).set(AUTH);

      // Send while paused
      await request(app)
        .post(`/api/rooms/${code}/messages`)
        .set(AUTH)
        .send({ client_id: a.body.client_id, message: "held" });

      // B sees nothing
      let msgs = await request(app)
        .get(`/api/rooms/${code}/messages?client_id=${b.body.client_id}`)
        .set(AUTH);
      expect(msgs.body.messages).toEqual([]);

      // Resume
      await request(app).post(`/api/rooms/${code}/resume`).set(AUTH);

      // B gets the held message
      msgs = await request(app)
        .get(`/api/rooms/${code}/messages?client_id=${b.body.client_id}`)
        .set(AUTH);
      expect(msgs.body.messages).toContainEqual(
        expect.objectContaining({ message: "held" })
      );
    });
  });
});
```

- [ ] **Step 2: Install supertest**

Run: `npm install -D supertest @types/supertest`

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/api.test.ts`
Expected: FAIL — cannot import createApp

- [ ] **Step 4: Implement the server**

Create `src/server.ts`:

```typescript
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { RoomManager } from "./room-manager.js";
import { createAuthMiddleware } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(secret: string) {
  const app = express();
  const rm = new RoomManager();

  app.use(express.json());

  // Serve dashboard without auth (login page handles auth client-side)
  app.use(express.static(path.join(__dirname, "..", "dashboard")));

  // Auth middleware for all /api routes
  app.use("/api", createAuthMiddleware(secret));

  // --- Room Management ---

  app.post("/api/rooms", (req, res) => {
    const result = rm.createRoom(req.body.name);
    res.json(result);
  });

  app.post("/api/rooms/:code/join", (req, res) => {
    try {
      const result = rm.joinRoom(req.params.code, req.body.name);
      res.json(result);
    } catch (err: any) {
      const status = err.message.includes("No room") ? 404 : 409;
      res.status(status).json({ error: err.message });
    }
  });

  app.post("/api/rooms/:code/disconnect", (req, res) => {
    rm.disconnect(req.params.code, req.body.client_id);
    res.json({ ok: true });
  });

  // --- Messaging ---

  app.post("/api/rooms/:code/messages", (req, res) => {
    try {
      rm.sendMessage(req.params.code, req.body.client_id, req.body.message);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/rooms/:code/messages", (req, res) => {
    try {
      const messages = rm.getMessages(req.params.code, req.query.client_id as string);
      res.json({ messages });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Dashboard Data ---

  app.get("/api/rooms", (_req, res) => {
    res.json(rm.listRooms());
  });

  app.get("/api/rooms/:code/transcript", (req, res) => {
    try {
      res.json({ messages: rm.getTranscript(req.params.code) });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  app.get("/api/rooms/:code/status", (req, res) => {
    try {
      res.json(rm.getRoomStatus(req.params.code));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // --- SSE Stream ---

  app.get("/api/rooms/:code/stream", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const unsubscribe = rm.onRoomEvent(req.params.code, (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    });

    req.on("close", unsubscribe);
  });

  // --- Dashboard Controls ---

  app.post("/api/rooms/:code/pause", (req, res) => {
    try {
      rm.pauseRoom(req.params.code);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  app.post("/api/rooms/:code/resume", (req, res) => {
    try {
      rm.resumeRoom(req.params.code);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  app.post("/api/rooms/:code/disconnect-all", (req, res) => {
    rm.disconnectAll(req.params.code);
    res.json({ ok: true });
  });

  // Cleanup intervals
  setInterval(() => {
    rm.cleanupStaleClients();
    rm.cleanupRooms();
  }, 60 * 1000);

  return app;
}

// Start server when run directly
const isMain = process.argv[1] && fileURLToPath(import.meta.url).includes(process.argv[1]);
if (isMain) {
  const dotenv = await import("dotenv");
  dotenv.config();

  const secret = process.env.BRIDGE_SECRET;
  if (!secret) {
    console.error("BRIDGE_SECRET is required. Create a .env file or set the environment variable.");
    process.exit(1);
  }

  const port = parseInt(process.env.PORT || "3000", 10);
  const app = createApp(secret);

  app.listen(port, "0.0.0.0", () => {
    console.log(`◆ Claude Chat Bridge running on http://0.0.0.0:${port}`);
    console.log(`  Dashboard: http://localhost:${port}`);
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/api.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/server.ts tests/api.test.ts
git commit -m "feat: Express REST API with room management, messaging, SSE, dashboard controls"
```

---

### Task 6: MCP Wrapper

**Files:**
- Create: `src/mcp-wrapper.ts`
- Create: `tests/mcp-wrapper.test.ts`

- [ ] **Step 1: Write failing tests for MCP wrapper HTTP client**

Create `tests/mcp-wrapper.test.ts`:

```typescript
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

    // Drain join notifications
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
    await b.checkMessages(); // drain

    await a.disconnect();
    const msgs = await b.checkMessages();
    expect(msgs).toContainEqual(
      expect.objectContaining({ from: "system", message: "The other intelligence has left the chat" })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp-wrapper.test.ts`
Expected: FAIL — cannot import BridgeClient

- [ ] **Step 3: Implement MCP wrapper with BridgeClient**

Create `src/mcp-wrapper.ts`:

```typescript
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
      throw new Error(body.error || `HTTP ${res.status}`);
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
          content: [
            {
              type: "text" as const,
              text: `Room created! Code: ${result.room_code}\nYour role: ${result.role}\nShare this code with the other Claude to connect.`,
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "join_room",
    "Join an existing chat room using a room code.",
    {
      room_code: z.string().describe("The room code to join"),
      name: z.string().optional().describe("Your display name for the chat"),
    },
    async ({ room_code, name }) => {
      try {
        const result = await client.joinRoom(room_code, name);
        return {
          content: [
            {
              type: "text" as const,
              text: `Joined room ${room_code}! Your role: ${result.role}\nYou can now send and receive messages.`,
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
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
        return {
          content: [{ type: "text" as const, text: "Message sent." }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
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
          return {
            content: [{ type: "text" as const, text: "No new messages." }],
          };
        }
        const formatted = messages
          .map((m) => `[${m.from}]: ${m.message}`)
          .join("\n");
        return {
          content: [{ type: "text" as const, text: formatted }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
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
        return {
          content: [{ type: "text" as const, text: "Disconnected from the room." }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mcp-wrapper.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-wrapper.ts tests/mcp-wrapper.test.ts
git commit -m "feat: MCP wrapper with BridgeClient and 5 tools"
```

---

### Task 7: Dashboard — HTML & CSS

**Files:**
- Create: `dashboard/index.html`
- Create: `dashboard/style.css`

- [ ] **Step 1: Create the dashboard HTML**

Create `dashboard/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Chat Bridge</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <!-- Login Screen -->
  <div id="login-screen">
    <div class="login-box">
      <h1>&#9670; Claude Chat Bridge</h1>
      <p>Enter the bridge secret to access the dashboard.</p>
      <input type="password" id="secret-input" placeholder="Bridge secret" autofocus>
      <button id="login-btn">Connect</button>
      <p id="login-error" class="error hidden"></p>
    </div>
  </div>

  <!-- Dashboard -->
  <div id="dashboard" class="hidden">
    <div class="sidebar">
      <div class="sidebar-header">&#9670; Chat Bridge</div>
      <div id="room-list" class="room-list"></div>
      <div class="sidebar-footer">
        <div id="server-info">Rooms: 0</div>
      </div>
    </div>

    <div class="main">
      <!-- Empty state -->
      <div id="empty-state" class="empty-state">
        <p>Select a room from the sidebar to view the transcript.</p>
      </div>

      <!-- Room view -->
      <div id="room-view" class="hidden">
        <div class="room-header">
          <div class="room-header-left">
            <span id="room-code" class="room-code"></span>
            <span id="room-stats" class="room-stats"></span>
          </div>
          <div id="room-badges" class="room-badges"></div>
        </div>

        <div id="transcript" class="transcript"></div>

        <div class="controls">
          <div class="controls-left">
            Auto-scroll: <span id="autoscroll-toggle" class="toggle on">ON</span>
          </div>
          <div class="controls-right">
            <button id="pause-btn" class="btn btn-warn">&#9208; Pause</button>
            <button id="disconnect-btn" class="btn btn-danger">&#10005; Disconnect All</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create the dashboard CSS**

Create `dashboard/style.css`:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
  background: #0d1117;
  color: #e6edf3;
  height: 100vh;
  overflow: hidden;
}

/* Login Screen */
#login-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
}

.login-box {
  text-align: center;
  max-width: 360px;
}

.login-box h1 {
  font-size: 20px;
  margin-bottom: 12px;
  color: #e6edf3;
}

.login-box p {
  font-size: 13px;
  color: #8b949e;
  margin-bottom: 20px;
}

.login-box input {
  width: 100%;
  padding: 10px 14px;
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 4px;
  color: #e6edf3;
  font-family: inherit;
  font-size: 13px;
  margin-bottom: 12px;
  outline: none;
}

.login-box input:focus {
  border-color: #3fb950;
}

.login-box button {
  width: 100%;
  padding: 10px;
  background: #161b22;
  border: 1px solid #3fb950;
  border-radius: 4px;
  color: #3fb950;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}

.login-box button:hover {
  background: #1a2332;
}

.error {
  color: #f85149;
  font-size: 12px;
  margin-top: 12px;
}

.hidden {
  display: none !important;
}

/* Dashboard Layout */
#dashboard {
  display: flex;
  height: 100vh;
}

/* Sidebar */
.sidebar {
  width: 220px;
  border-right: 1px solid #21262d;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  padding: 14px 12px;
  font-size: 14px;
  border-bottom: 1px solid #21262d;
  color: #e6edf3;
}

.room-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.room-item {
  padding: 8px 10px;
  border-left: 2px solid transparent;
  border-radius: 0 4px 4px 0;
  margin-bottom: 4px;
  cursor: pointer;
  font-size: 12px;
}

.room-item:hover {
  background: #161b22;
}

.room-item.selected {
  background: #161b22;
  border-left-color: #3fb950;
}

.room-item .room-name {
  color: #e6edf3;
}

.room-item .room-meta {
  color: #8b949e;
  font-size: 10px;
  margin-top: 2px;
}

.status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 4px;
}

.status-dot.active { background: #3fb950; }
.status-dot.waiting { background: #f0883e; }
.status-dot.ended { background: #f85149; }

.sidebar-footer {
  padding: 12px;
  border-top: 1px solid #21262d;
  font-size: 11px;
  color: #8b949e;
}

/* Main Panel */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #8b949e;
  font-size: 13px;
}

/* Room Header */
.room-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid #21262d;
  background: #161b22;
}

.room-code {
  font-size: 13px;
  color: #e6edf3;
}

.room-stats {
  font-size: 11px;
  color: #8b949e;
  margin-left: 12px;
}

.room-badges {
  display: flex;
  gap: 8px;
}

.badge {
  padding: 3px 10px;
  background: #1a1a2e;
  border: 1px solid #3fb950;
  border-radius: 3px;
  font-size: 11px;
  color: #3fb950;
}

.badge.disconnected {
  border-color: #f85149;
  color: #f85149;
}

/* Transcript */
.transcript {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  line-height: 2;
  font-size: 12px;
}

.msg-line {
  word-wrap: break-word;
}

.msg-time {
  color: #484f58;
}

.msg-system {
  color: #8b949e;
}

.msg-sender-a {
  color: #3fb950;
}

.msg-sender-b {
  color: #d2a8ff;
}

.msg-cursor {
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

/* Controls */
.controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-top: 1px solid #21262d;
  background: #161b22;
  font-size: 11px;
}

.controls-left {
  color: #8b949e;
}

.toggle {
  cursor: pointer;
}

.toggle.on {
  color: #3fb950;
}

.toggle.off {
  color: #f85149;
}

.controls-right {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 4px 14px;
  background: #1a1a2e;
  border-radius: 3px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid;
}

.btn-warn {
  border-color: #e3b341;
  color: #e3b341;
}

.btn-warn:hover {
  background: #2a2520;
}

.btn-danger {
  border-color: #f85149;
  color: #f85149;
}

.btn-danger:hover {
  background: #2a1a1a;
}
```

- [ ] **Step 3: Verify dashboard loads**

Run: `cd C:/Users/aiint/Downloads/claude-chat-bridge && echo "BRIDGE_SECRET=test" > .env && npx tsx src/server.ts`

Open `http://localhost:3000` in browser — should see login screen with dark theme.
Stop server with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add dashboard/index.html dashboard/style.css
git commit -m "feat: terminal-style dashboard HTML and CSS"
```

---

### Task 8: Dashboard — Client-Side JavaScript

**Files:**
- Create: `dashboard/app.js`

- [ ] **Step 1: Implement dashboard app.js**

Create `dashboard/app.js`:

```javascript
(function () {
  let secret = null;
  let selectedRoom = null;
  let autoScroll = true;
  let eventSource = null;
  let pollInterval = null;

  // --- Auth ---

  function authHeaders() {
    return { Authorization: "Bearer " + secret, "Content-Type": "application/json" };
  }

  async function apiFetch(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { ...authHeaders(), ...options.headers },
    });
    if (res.status === 401) {
      showLogin("Invalid secret.");
      throw new Error("Unauthorized");
    }
    return res.json();
  }

  // --- Login ---

  const loginScreen = document.getElementById("login-screen");
  const dashboard = document.getElementById("dashboard");
  const secretInput = document.getElementById("secret-input");
  const loginBtn = document.getElementById("login-btn");
  const loginError = document.getElementById("login-error");

  loginBtn.addEventListener("click", tryLogin);
  secretInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryLogin();
  });

  async function tryLogin() {
    secret = secretInput.value.trim();
    if (!secret) return;

    try {
      await apiFetch("/api/rooms");
      loginScreen.classList.add("hidden");
      dashboard.classList.remove("hidden");
      startPollingRooms();
    } catch {
      showLogin("Invalid secret. Try again.");
    }
  }

  function showLogin(msg) {
    loginScreen.classList.remove("hidden");
    dashboard.classList.add("hidden");
    if (msg) {
      loginError.textContent = msg;
      loginError.classList.remove("hidden");
    }
    secret = null;
  }

  // --- Room List ---

  const roomListEl = document.getElementById("room-list");
  const serverInfoEl = document.getElementById("server-info");

  function startPollingRooms() {
    loadRooms();
    pollInterval = setInterval(loadRooms, 3000);
  }

  async function loadRooms() {
    try {
      const rooms = await apiFetch("/api/rooms");
      renderRoomList(rooms);
      serverInfoEl.textContent = "Rooms: " + rooms.length;
    } catch { /* ignore */ }
  }

  function renderRoomList(rooms) {
    roomListEl.innerHTML = rooms
      .map((r) => {
        const statusClass = r.status;
        const statusText =
          r.status === "active" ? r.connectedCount + " connected" :
          r.status === "waiting" ? "1 waiting" : "ended";
        const selected = selectedRoom === r.code ? " selected" : "";
        return `
          <div class="room-item${selected}" data-code="${r.code}">
            <div class="room-name">${r.code}</div>
            <div class="room-meta">
              <span class="status-dot ${statusClass}"></span>
              ${statusText} &middot; ${r.messageCount} msgs
            </div>
          </div>`;
      })
      .join("");

    roomListEl.querySelectorAll(".room-item").forEach((el) => {
      el.addEventListener("click", () => selectRoom(el.dataset.code));
    });
  }

  // --- Room View ---

  const emptyState = document.getElementById("empty-state");
  const roomView = document.getElementById("room-view");
  const roomCodeEl = document.getElementById("room-code");
  const roomStatsEl = document.getElementById("room-stats");
  const roomBadgesEl = document.getElementById("room-badges");
  const transcriptEl = document.getElementById("transcript");
  const pauseBtn = document.getElementById("pause-btn");
  const disconnectBtn = document.getElementById("disconnect-btn");
  const autoscrollToggle = document.getElementById("autoscroll-toggle");

  async function selectRoom(code) {
    selectedRoom = code;
    emptyState.classList.add("hidden");
    roomView.classList.remove("hidden");
    roomCodeEl.textContent = code;

    // Load transcript
    try {
      const { messages } = await apiFetch("/api/rooms/" + code + "/transcript");
      const status = await apiFetch("/api/rooms/" + code + "/status");
      renderTranscript(messages, status);
      renderStatus(status);
    } catch { /* ignore */ }

    // Connect SSE
    connectSSE(code);

    // Re-render room list to show selection
    loadRooms();
  }

  function renderTranscript(messages, status) {
    const clientNames = status.clients.map((c) => c.name);
    transcriptEl.innerHTML = messages
      .map((m) => formatMessage(m, clientNames))
      .join("");

    if (autoScroll) {
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }
  }

  function formatMessage(msg, clientNames) {
    const time = new Date(msg.timestamp).toLocaleTimeString("en-US", { hour12: false });
    if (msg.from === "system") {
      return `<div class="msg-line"><span class="msg-time">[${time}]</span> <span class="msg-system">${msg.from}</span> — ${escapeHtml(msg.message)}</div>`;
    }
    const isFirstClient = clientNames.length > 0 && msg.from === clientNames[0];
    const senderClass = isFirstClient ? "msg-sender-a" : "msg-sender-b";
    return `<div class="msg-line"><span class="msg-time">[${time}]</span> <span class="${senderClass}">${escapeHtml(msg.from)}</span> — ${escapeHtml(msg.message)}</div>`;
  }

  function renderStatus(status) {
    roomStatsEl.textContent = status.messageCount + " messages";
    roomBadgesEl.innerHTML = status.clients
      .map((c) => `<span class="badge">&bull; ${escapeHtml(c.name)}</span>`)
      .join("");

    // Update pause button text
    if (status.paused) {
      pauseBtn.textContent = "\u25B6 Resume";
      pauseBtn.className = "btn btn-warn";
    } else {
      pauseBtn.textContent = "\u23F8 Pause";
      pauseBtn.className = "btn btn-warn";
    }
  }

  // --- SSE ---

  function connectSSE(code) {
    if (eventSource) eventSource.close();
    // SSE doesn't support custom headers, so we pass secret as query param
    eventSource = new EventSource("/api/rooms/" + code + "/stream?secret=" + encodeURIComponent(secret));

    eventSource.addEventListener("message", async () => {
      // Reload transcript on any new message
      try {
        const { messages } = await apiFetch("/api/rooms/" + code + "/transcript");
        const status = await apiFetch("/api/rooms/" + code + "/status");
        renderTranscript(messages, status);
        renderStatus(status);
      } catch { /* ignore */ }
    });

    eventSource.addEventListener("client-joined", async () => {
      try {
        const status = await apiFetch("/api/rooms/" + code + "/status");
        renderStatus(status);
      } catch { /* ignore */ }
    });

    eventSource.addEventListener("client-left", async () => {
      try {
        const status = await apiFetch("/api/rooms/" + code + "/status");
        renderStatus(status);
      } catch { /* ignore */ }
    });

    eventSource.onerror = () => {
      // Will auto-reconnect
    };
  }

  // --- Controls ---

  let isPaused = false;

  pauseBtn.addEventListener("click", async () => {
    if (!selectedRoom) return;
    const action = isPaused ? "resume" : "pause";
    await apiFetch("/api/rooms/" + selectedRoom + "/" + action, { method: "POST" });
    isPaused = !isPaused;
    const status = await apiFetch("/api/rooms/" + selectedRoom + "/status");
    renderStatus(status);
  });

  disconnectBtn.addEventListener("click", async () => {
    if (!selectedRoom) return;
    if (!confirm("Disconnect both Claudes from this room?")) return;
    await apiFetch("/api/rooms/" + selectedRoom + "/disconnect-all", { method: "POST" });
    const status = await apiFetch("/api/rooms/" + selectedRoom + "/status");
    renderStatus(status);
  });

  autoscrollToggle.addEventListener("click", () => {
    autoScroll = !autoScroll;
    autoscrollToggle.textContent = autoScroll ? "ON" : "OFF";
    autoscrollToggle.className = "toggle " + (autoScroll ? "on" : "off");
  });

  // --- Helpers ---

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
```

- [ ] **Step 2: Update server SSE endpoint to support query param auth**

In `src/server.ts`, update the SSE endpoint to also accept `?secret=` query param for EventSource compatibility (since EventSource can't send custom headers):

Add this check to the SSE route — allow auth via either header or query param.

- [ ] **Step 3: Manual test — start server, open dashboard, verify login and empty state**

Run: `npx tsx src/server.ts`
Open: `http://localhost:3000`
Verify: Login prompt appears, entering correct secret shows dashboard.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app.js src/server.ts
git commit -m "feat: dashboard client-side JS with auth, room list, transcript, SSE, controls"
```

---

### Task 9: Integration Test & Polish

**Files:**
- Modify: `src/server.ts` (SSE query param auth)
- Modify: `package.json` (bin entry for npm distribution)

- [ ] **Step 1: Add SSE query param auth to server**

In `src/server.ts`, update the SSE stream endpoint to accept auth via query param:

```typescript
// In the SSE route handler, before setting up the stream:
app.get("/api/rooms/:code/stream", (req, res) => {
  // Allow auth via query param for EventSource (can't set headers)
  const querySecret = req.query.secret as string;
  const headerSecret = req.headers.authorization?.replace("Bearer ", "");
  if (querySecret !== secret && headerSecret !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // ... rest of SSE handler
});
```

To implement: move the SSE route registration BEFORE the `app.use("/api", createAuthMiddleware(secret))` line so it handles its own auth via the query param check above, bypassing the global middleware.

- [ ] **Step 2: Add bin entry to package.json for npm distribution**

Add to `package.json`:
```json
{
  "bin": {
    "claude-chat-bridge": "./dist/server.js"
  },
  "files": ["dist", "dashboard"]
}
```

- [ ] **Step 3: Add build verification**

Run: `npx tsc`
Expected: No errors, `dist/` directory created with compiled JS

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass across all test files

- [ ] **Step 5: Manual end-to-end test**

1. Start server: `echo "BRIDGE_SECRET=test123" > .env && npx tsx src/server.ts`
2. Open dashboard: `http://localhost:3000`, login with "test123"
3. In another terminal, simulate two clients using curl:

```bash
# Create room
curl -s -X POST http://localhost:3000/api/rooms -H "Authorization: Bearer test123" -H "Content-Type: application/json" -d '{"name":"Nova"}'

# Join room (use room_code from above)
curl -s -X POST http://localhost:3000/api/rooms/ROOM_CODE/join -H "Authorization: Bearer test123" -H "Content-Type: application/json" -d '{"name":"Atlas"}'

# Send message
curl -s -X POST http://localhost:3000/api/rooms/ROOM_CODE/messages -H "Authorization: Bearer test123" -H "Content-Type: application/json" -d '{"client_id":"CLIENT_ID","message":"Hello from Nova!"}'

# Check messages
curl -s http://localhost:3000/api/rooms/ROOM_CODE/messages?client_id=OTHER_CLIENT_ID -H "Authorization: Bearer test123"
```

4. Verify messages appear in real-time on dashboard

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: integration polish — SSE auth, build config, all tests passing"
```
