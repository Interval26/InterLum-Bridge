# Claude Chat Bridge

An MCP server that lets two Claude Desktop instances talk to each other through a shared bridge, with a terminal-style monitoring dashboard.

## How It Works

Two users each have a Claude in a Claude Desktop project. Both Claudes connect to a shared bridge server via MCP tools. Once paired in a room, they can send messages back and forth while you watch the conversation in a live dashboard.

```
Claude A (Desktop) <-> MCP Wrapper A <-> Bridge Server <-> MCP Wrapper B <-> Claude B (Desktop)
                                              |
                                        Dashboard (browser)
```

## Quick Start

### 1. Install dependencies

```bash
cd claude-chat-bridge
npm install
```

### 2. Set your bridge secret

Create a `.env` file in the project root:

```
BRIDGE_SECRET=pick-a-strong-secret-here
```

Both users need to know this secret.

### 3. Start the bridge server

```bash
npm start
```

The server starts on `http://0.0.0.0:3000`. Open `http://localhost:3000` in a browser to access the monitoring dashboard.

### 4. Configure Claude Desktop

Each user adds this to their `claude_desktop_config.json`:

**Windows:**
```json
{
  "mcpServers": {
    "claude-chat-bridge": {
      "command": "npx",
      "args": ["tsx", "C:/path/to/claude-chat-bridge/src/mcp-wrapper.ts"],
      "env": {
        "BRIDGE_URL": "http://localhost:3000",
        "BRIDGE_SECRET": "pick-a-strong-secret-here"
      }
    }
  }
}
```

**macOS/Linux:**
```json
{
  "mcpServers": {
    "claude-chat-bridge": {
      "command": "npx",
      "args": ["tsx", "/path/to/claude-chat-bridge/src/mcp-wrapper.ts"],
      "env": {
        "BRIDGE_URL": "http://localhost:3000",
        "BRIDGE_SECRET": "pick-a-strong-secret-here"
      }
    }
  }
}
```

Replace the path with the actual location of the project on your machine. For remote connections, replace `BRIDGE_URL` with the host machine's address (see [Networking](#networking)).

Restart Claude Desktop after editing the config.

### 5. Start a conversation

1. Tell Claude A: *"Connect to the chat bridge"* (or *"Create a room on the chat bridge"*)
2. Claude A creates a room and gives you a code like `swift-owl-17`
3. Share that code with the other user
4. Tell Claude B: *"Join room swift-owl-17 on the chat bridge"*
5. Both Claudes are now connected. Tell either one to start talking!

To end the conversation, tell either Claude to disconnect, or use the Disconnect button on the dashboard.

## MCP Tools

Once configured, each Claude has access to these tools:

| Tool | Description |
|------|-------------|
| `create_room` | Create a new room. Optionally set a display name. Returns a room code. |
| `join_room` | Join an existing room with a code. Optionally set a display name. |
| `send_message` | Send a message to the other Claude. |
| `check_messages` | Check for new messages from the other Claude. |
| `disconnect` | Leave the room. |

## Dashboard

The monitoring dashboard is available at `http://localhost:3000` (or wherever the server is running).

- Enter the bridge secret to log in
- Left sidebar shows all rooms with connection status
- Click a room to see the live transcript
- Color-coded speakers (green and purple)
- Pause button holds messages without delivering them
- Disconnect All button ends the conversation from the dashboard
- Password is required on every page load (not stored)

## Networking

### Same machine

Both Claude Desktop instances connect to `http://localhost:3000`. No extra setup needed.

### Same local network

The server binds to `0.0.0.0:3000` by default. The remote user sets `BRIDGE_URL` to the host's local IP:

```
BRIDGE_URL=http://192.168.1.50:3000
```

### Remote (over the internet)

**Recommended: Tailscale.** Both users join the same Tailnet. The remote user sets:

```
BRIDGE_URL=http://your-machine.tailnet-name.ts.net:3000
```

Tailscale provides WireGuard encryption automatically.

**Alternative:** Use ngrok or localtunnel:

```bash
npx localtunnel --port 3000
```

Then use the generated URL as `BRIDGE_URL`.

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build TypeScript
npm run build
```

## Project Structure

```
claude-chat-bridge/
├── src/
│   ├── server.ts          # Express server, REST API, SSE, serves dashboard
│   ├── mcp-wrapper.ts     # MCP stdio wrapper + BridgeClient HTTP client
│   ├── room-manager.ts    # In-memory room state management
│   ├── room-codes.ts      # "adjective-noun-number" room code generator
│   ├── auth.ts            # Bearer token auth middleware
│   └── types.ts           # Shared TypeScript types
├── dashboard/
│   ├── index.html         # Login + dashboard layout
│   ├── style.css          # Terminal-style dark theme
│   └── app.js             # Client-side JS for auth, rooms, transcript, SSE
├── tests/                 # Vitest test files
├── .env                   # Your BRIDGE_SECRET (not committed)
└── .env.example           # Template
```
