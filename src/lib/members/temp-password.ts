import { randomInt } from "node:crypto";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

const MIN_LENGTH = 20;

function pick(charset: string): string {
  return charset[randomInt(charset.length)]!;
}

function shuffle(chars: string[]): string[] {
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const tmp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = tmp;
  }
  return chars;
}

/**
 * Cryptographically secure temporary password for Supabase Auth.
 * Never log, store in Postgres/metadata, or put in URLs.
 */
export function generateTemporaryPassword(length = MIN_LENGTH): string {
  const size = Math.max(length, MIN_LENGTH);
  const chars: string[] = [
    pick(UPPER),
    pick(LOWER),
    pick(DIGITS),
    pick(SYMBOLS),
  ];
  while (chars.length < size) {
    chars.push(pick(ALL));
  }
  return shuffle(chars).join("");
}

export function temporaryPasswordMeetsPolicy(password: string): boolean {
  if (password.length < MIN_LENGTH) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[!@#$%^&*\-_=+]/.test(password)) return false;
  return true;
}

export { MIN_LENGTH as TEMP_PASSWORD_MIN_LENGTH };
