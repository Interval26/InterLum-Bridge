import { v4 as uuidv4 } from "uuid";
import { generateRoomCode } from "./room-codes.js";
import type { Room, Client, Message } from "./types.js";

interface UnreadTracker {
  [clientId: string]: Message[];
}

interface RoomInternal extends Room {
  unread: UnreadTracker;
  heldMessages: Message[];
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
    const client: Client = { id: clientId, name: name || "Claude A", role: "Claude A", lastPoll: Date.now() };
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
    const client: Client = { id: clientId, name: name || "Claude B", role: "Claude B", lastPoll: Date.now() };
    room.clients.push(client);
    room.unread[clientId] = [];
    const joinMsg: Message = { from: "system", message: "Another intelligence has joined the chat", timestamp: Date.now() };
    room.messages.push(joinMsg);
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
    const msg: Message = { from: sender.name, message, timestamp: Date.now() };
    room.messages.push(msg);
    if (room.paused) {
      room.heldMessages.push(msg);
    } else {
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
    const msg: Message = { from: "system", message: "The other intelligence has left the chat", timestamp: Date.now() };
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
    const msg: Message = { from: "system", message: "The other intelligence has left the chat", timestamp: Date.now() };
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
    for (const msg of room.heldMessages) {
      for (const c of room.clients) {
        const sender = room.clients.find((cl) => cl.name === msg.from);
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
      clients: room.clients.map((c) => ({ name: c.name, role: c.role, connected: true })),
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
      status: room.clients.length === 2 ? "active" : room.clients.length === 1 ? "waiting" : "ended",
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
      if (room.clients.length === 0 && room.disconnectedAt !== null && now - room.disconnectedAt >= timeoutMs) {
        this.rooms.delete(code);
        this.existingCodes.delete(code);
      }
    }
  }

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
