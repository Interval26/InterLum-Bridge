import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { RoomManager } from "./room-manager.js";
import { createAuthMiddleware } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(secret: string, options?: { enableCleanup?: boolean }) {
  const app = express();
  const rm = new RoomManager();

  app.use(express.json());

  // Serve dashboard without auth (login page handles auth client-side)
  app.use(express.static(path.join(__dirname, "..", "dashboard")));

  // --- SSE Stream (before auth middleware — handles its own auth via query param) ---

  app.get("/api/rooms/:code/stream", (req, res) => {
    const querySecret = req.query.secret as string;
    const headerSecret = req.headers.authorization?.replace("Bearer ", "");
    if (querySecret !== secret && headerSecret !== secret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

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

  // Cleanup stale clients and empty rooms every 60 seconds (only in production)
  if (options?.enableCleanup) {
    setInterval(() => {
      rm.cleanupStaleClients();
      rm.cleanupRooms();
    }, 60 * 1000);
  }

  return app;
}

// Start server when run directly
const isMain =
  process.argv[1] != null &&
  fileURLToPath(import.meta.url).replace(/\\/g, "/").endsWith(process.argv[1].replace(/\\/g, "/"));

if (isMain) {
  const dotenv = await import("dotenv");
  dotenv.config();

  const secret = process.env.BRIDGE_SECRET;
  if (!secret) {
    console.error("BRIDGE_SECRET is required. Create a .env file or set the environment variable.");
    process.exit(1);
  }

  const port = parseInt(process.env.PORT || "3000", 10);
  const app = createApp(secret, { enableCleanup: true });

  app.listen(port, "0.0.0.0", () => {
    console.log(`◆ Claude Chat Bridge running on http://0.0.0.0:${port}`);
    console.log(`  Dashboard: http://localhost:${port}`);
  });
}
