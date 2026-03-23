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
