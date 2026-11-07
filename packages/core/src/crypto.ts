import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export function secret(): string {
  return randomBytes(32).toString('base64url');
}
export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$32768$8$3$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$32768$8$3') return false;
  const salt = Buffer.from(parts[4] ?? '', 'base64url');
  const expected = Buffer.from(parts[5] ?? '', 'base64url');
  if (salt.length !== 16 || expected.length !== 64) return false;
  try {
    return timingSafeEqual(await derive(password, salt), expected);
  } catch {
    return false;
  }
}
