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
