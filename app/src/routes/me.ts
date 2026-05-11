import type { Request, Response } from 'express';

export function meRoute() {
  return (req: Request, res: Response): void => {
    const u = req.user!;
    res.json({ id: u.id, email: u.email, displayName: u.displayName });
  };
}
