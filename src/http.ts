import type { NextFunction, Request, RequestHandler, Response } from "express";

// Membungkus handler async supaya error masuk ke error handler (aman di Express 4 maupun 5)
export const ah =
  (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function parseId(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const bad = (res: Response, message: string) => {
  res.status(400).json({ message });
};
