import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";

const SECRET = "test-secret";
const AUTH = { Authorization: `Bearer ${SECRET}` };

describe("API", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.useFakeTimers();
    app = createApp(SECRET);
  });

  afterEach(() => {
    vi.useRealTimers();
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

      await request(app).get(`/api/rooms/${code}/messages?client_id=${a.body.client_id}`).set(AUTH);
      await request(app).get(`/api/rooms/${code}/messages?client_id=${b.body.client_id}`).set(AUTH);

      await request(app)
        .post(`/api/rooms/${code}/messages`)
        .set(AUTH)
        .send({ client_id: a.body.client_id, message: "Hello!" });

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

      await request(app).post(`/api/rooms/${code}/pause`).set(AUTH);

      await request(app)
        .post(`/api/rooms/${code}/messages`)
        .set(AUTH)
        .send({ client_id: a.body.client_id, message: "held" });

      let msgs = await request(app)
        .get(`/api/rooms/${code}/messages?client_id=${b.body.client_id}`)
        .set(AUTH);
      expect(msgs.body.messages).toEqual([]);

      await request(app).post(`/api/rooms/${code}/resume`).set(AUTH);

      msgs = await request(app)
        .get(`/api/rooms/${code}/messages?client_id=${b.body.client_id}`)
        .set(AUTH);
      expect(msgs.body.messages).toContainEqual(
        expect.objectContaining({ message: "held" })
      );
    });
  });
});
