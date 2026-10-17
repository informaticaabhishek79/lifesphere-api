import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js/max';
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

/**
 * Normalise a phone number to E.164 using the full international numbering plan.
 * Numbers without a +country prefix are read in `defaultCountry` (ISO 3166 alpha-2, e.g. "IN", "GB").
 * Returns null when the number is not a valid mobile/fixed number for that country.
 */
export function normalizePhone(input: string, defaultCountry: string = 'IN'): string | null {
  const raw = input.trim().replace(/^00/, '+');
  const country = /^[A-Za-z]{2}$/.test(defaultCountry) ? (defaultCountry.toUpperCase() as CountryCode) : undefined;
  const p = parsePhoneNumberFromString(raw, raw.startsWith('+') ? undefined : country);
  if (!p || !p.isValid()) return null;
  // Sign-in codes and alerts go by SMS, so only numbers that can be mobiles are accepted.
  const type = p.getType();
  if (type && type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') return null;
  return p.number;
}

/** ISO country of an E.164 number, e.g. +447700900123 → GB. */
export function phoneCountry(e164: string | null | undefined): string | null {
  if (!e164) return null;
  return parsePhoneNumberFromString(e164)?.country ?? null;
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
