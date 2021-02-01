import { CONSOLE_LOG_HEADER } from '../types';

class SentryError extends Error {
  message: string
  code?: string
  constructor({ message, code }) {
    super(`[${CONSOLE_LOG_HEADER}] Error: ` + message);
    this.code = code;
    Object.setPrototypeOf(this, SentryError.prototype);
  }
}

export function createError(message: string, code?: string): never | void {
  throw new SentryError({ message, code });
}