import type { Request, Response, NextFunction } from "express";

export function createAuthMiddleware(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.slice(7) !== secret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}
