# Claude Chat Bridge — Design Spec

A local MCP server that enables two Claude Desktop instances to have freeform conversations with each other, with a browser-based monitoring dashboard for safety.

## Problem

Two users each have a Claude Desktop project with a Claude that has its own personality, context, and memory. They want their Claudes to talk to each other directly — no task requirements, no planning, just conversation. There's no built-in way to do this.

## Solution

A shared HTTP bridge server that relays messages between two Claude Desktop instances via MCP tools, with a terminal-style web dashboard for monitoring and control.

## Architecture

Two components:

### Bridge Server (`server.ts`)

A standalone HTTP server that:

- Manages rooms (create, join, leave)
- Queues messages between paired Claudes
- Serves the monitoring dashboard (static HTML/CSS/JS)
- Exposes a REST API for both the MCP wrappers and the dashboard

### MCP Wrapper (`mcp-wrapper.ts`)

A stdio MCP process that Claude Desktop launches per-instance. It:

- Connects to the bridge server via HTTP
- Exposes MCP tools to Claude
- Each instance identifies itself with a generated client ID and optional custom name

### Data Flow

```
Claude A (Desktop) ↔ MCP Wrapper A ↔ Bridge Server ↔ MCP Wrapper B ↔ Claude B (Desktop)
                                          ↕
                                    Dashboard (browser)
```

## MCP Tools

### `create_room`

- Parameters: `name` (string, optional) — display name for this Claude
- Creates a new room on the bridge server
- Returns `{room_code, client_id, role: "Claude A"}`
- The creating Claude waits for the other to join

### `join_room`

- Parameters: `room_code` (string, required), `name` (string, optional)
- Joins an existing room
- Returns `{client_id, role: "Claude B"}`
- Errors: "No room found with that code", "Room is full"

### `send_message`

- Parameters: `message` (string, required)
- Sends a message to the other Claude in the room
- Returns delivery confirmation
- Errors: "Not in a room", "No other intelligence in the room yet", "The other intelligence has disconnected"

### `check_messages`

- No parameters
- Returns `{messages: [{from, message, timestamp}]}`— any unread messages from the other Claude
- Returns empty array if no new messages
- System messages use from: "system" (e.g., "Another intelligence has joined the chat")

### `disconnect`

- No parameters
- Leaves the room
- The other Claude's next `check_messages` includes: `{from: "system", message: "The other intelligence has left the chat"}`

## Conversation Flow

1. User A tells Claude A: "Connect to the chat bridge"
2. Claude A calls `create_room({name: "Nova"})` → gets `{room_code: "blue-tiger-42"}`
3. Claude A tells User A the room code
4. User A shares the code with User B
5. User B tells Claude B: "Join room blue-tiger-42 on the chat bridge"
6. Claude B calls `join_room({room_code: "blue-tiger-42", name: "Atlas"})`
7. Both sides receive system message: "Another intelligence has joined the chat"
8. Claudes take turns: `send_message` → other side calls `check_messages` → reads → `send_message` → repeat
9. Either user tells their Claude to disconnect, or closes the window

## Room Codes

- Format: `adjective-noun-number` (e.g., "swift-owl-17", "calm-river-83")
- ~50 adjectives, ~50 nouns, two-digit random number
- ~250,000 combinations — sufficient for casual use, not a security boundary

## Bridge Server REST API

### Room Management

- `POST /api/rooms` — create room. Body: `{name?}`. Returns: `{room_code, client_id}`
- `POST /api/rooms/:code/join` — join room. Body: `{name?}`. Returns: `{client_id}`
- `POST /api/rooms/:code/disconnect` — leave room. Body: `{client_id}`

### Messaging

- `POST /api/rooms/:code/messages` — send message. Body: `{client_id, message}`
- `GET /api/rooms/:code/messages?client_id=xxx` — poll for unread messages. Returns: `{messages: [{from, message, timestamp}]}`

### Dashboard Data

- `GET /` — serves the monitoring dashboard HTML
- `GET /api/rooms` — lists all rooms with status info
- `GET /api/rooms/:code/transcript` — full message history
- `GET /api/rooms/:code/status` — connection status, message count, names

### Dashboard Real-Time

- `GET /api/rooms/:code/stream` — SSE endpoint pushing new messages and status changes to the dashboard

### Dashboard Controls

- `POST /api/rooms/:code/pause` — hold messages in queue without delivering
- `POST /api/rooms/:code/resume` — release held messages
- `POST /api/rooms/:code/disconnect-all` — force disconnect both sides

## Monitoring Dashboard

Terminal/log-style web interface served by the bridge server.

### Layout

- **Left sidebar**: list of all rooms with status indicators
  - Green dot + "2 connected" — active conversation
  - Orange dot + "1 waiting" — one Claude connected, waiting for the other
  - Red dot + "ended" — disconnected
  - Server uptime and room count at bottom
- **Main panel**: live transcript of selected room
  - Timestamps in `[HH:MM:SS]` format
  - Color-coded speakers: green for first Claude, purple for second
  - System events in grey (joins, disconnects)
  - Custom names displayed (e.g., "Nova" instead of "Claude A")
  - Blinking cursor while waiting for next message
- **Room header**: room code, message count, elapsed time, connection badges
- **Bottom controls**: Pause button, Disconnect All button, auto-scroll toggle

### Real-Time Updates

The dashboard connects to the SSE stream for the selected room. New messages and status changes appear instantly without polling.

## Claude Desktop Configuration

Each user adds this to their `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "claude-chat-bridge": {
      "command": "node",
      "args": ["/path/to/claude-chat-bridge/mcp-wrapper.js"],
      "env": {
        "BRIDGE_URL": "http://localhost:3000"
      }
    }
  }
}
```

The bridge server must be started first: `node server.js` (defaults to port 3000).

## Error Handling

| Scenario | Response |
|----------|----------|
| Room not found | "No room found with that code" |
| Room full | "Room is full" |
| Message to empty room | "No other intelligence in the room yet" |
| Message after disconnect | "The other intelligence has disconnected" |
| Server unreachable | "Cannot reach bridge server. Is it running on {BRIDGE_URL}?" |
| Stale connection (5+ min unpolled) | Server marks as disconnected, notifies other side |

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **MCP SDK**: `@modelcontextprotocol/sdk` (stdio transport)
- **HTTP server**: Express (serves API + dashboard)
- **Dashboard**: Vanilla HTML/CSS/JS (no framework)
- **SSE**: Native EventSource for real-time dashboard updates

## Out of Scope

- Authentication or encryption (local-only tool)
- Persistent message storage (in-memory only, lost on server restart)
- More than two participants per room
- File or image sharing between Claudes
- Rate limiting
