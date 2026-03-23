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
      rm.getMessages(a.room_code, b.client_id);

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
      rm.getMessages(a.room_code, b.client_id);

      rm.pauseRoom(a.room_code);
      rm.sendMessage(a.room_code, a.client_id, "held message");
      const msgs = rm.getMessages(a.room_code, b.client_id);
      expect(msgs).toEqual([]);
    });

    it("releases held messages on resume", () => {
      const a = rm.createRoom("Nova");
      const b = rm.joinRoom(a.room_code, "Atlas");
      rm.getMessages(a.room_code, b.client_id);

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
      rm.cleanupRooms(0);
      expect(rm.getRoom(a.room_code)).toBeUndefined();
    });

    it("cleanupStaleClients disconnects stale clients and notifies the other client", () => {
      const a = rm.createRoom("Nova");
      const b = rm.joinRoom(a.room_code, "Atlas");
      rm.getMessages(a.room_code, a.client_id);
      rm.getMessages(a.room_code, b.client_id);

      // staleMs=0 marks every client as stale immediately
      rm.cleanupStaleClients(0);

      // The room transcript should contain the disconnect system message
      const transcript = rm.getTranscript(a.room_code);
      expect(transcript).toContainEqual(
        expect.objectContaining({ from: "system", message: "The other intelligence has left the chat" })
      );
    });
  });
});
