import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Env, ENV } from '../config/env';

@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  }

  /** Keyed hash for lookups of identifiers we don't want stored in plain text (phones, emails, IPs, tokens). */
  hmac(value: string, purpose = 'id'): string {
    return createHmac('sha256', this.env.HASH_PEPPER).update(`${purpose}:${value}`).digest('hex');
  }

  sha256(data: Buffer | string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /** URL-safe random token (default 32 bytes = 256 bits). */
  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  numericCode(digits = 6): string {
    return randomInt(0, 10 ** digits)
      .toString()
      .padStart(digits, '0');
  }

  safeEqualHex(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
  }

  decrypt(payload: string): string {
    const [v, iv, tag, data] = payload.split('.');
    if (v !== 'v1') throw new Error('Unknown ciphertext version');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}

/** Normalise an Indian or international phone number to E.164. Returns null when invalid. */
export function normalizePhone(input: string, defaultCountry = '91'): string | null {
  const raw = input.replace(/[\s\-().]/g, '');
  let digits: string;
  if (raw.startsWith('+')) digits = raw.slice(1);
  else if (raw.startsWith('00')) digits = raw.slice(2);
  else if (/^0?\d{10}$/.test(raw)) digits = defaultCountry + raw.replace(/^0/, '');
  else digits = raw;
  if (!/^\d{8,15}$/.test(digits)) return null;
  if (digits.startsWith('91') && !/^91[6-9]\d{9}$/.test(digits)) return null;
  return `+${digits}`;
}

export function normalizeEmail(input: string): string | null {
  const e = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254 ? e : null;
}

/** Mask for display in UI/notifications: +91******3210, a***@example.com */
export function maskPhone(e164: string): string {
  return e164.slice(0, 3) + '*'.repeat(Math.max(0, e164.length - 7)) + e164.slice(-4);
}
export function maskEmail(email: string): string {
  const [u, d] = email.split('@');
  return `${u.slice(0, 1)}***@${d}`;
}
