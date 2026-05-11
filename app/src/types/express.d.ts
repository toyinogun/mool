import type { User } from '../auth/authStore';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

export {};
