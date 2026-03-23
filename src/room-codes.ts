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
