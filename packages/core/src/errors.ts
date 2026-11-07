import type { z } from 'zod';
export class AppError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 429,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'INVALID_INPUT', 'Invalid input');
  return result.data;
}
export function notFound(): never {
  throw new AppError(404, 'NOT_FOUND', 'Not found');
}
