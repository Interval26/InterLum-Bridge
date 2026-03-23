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
