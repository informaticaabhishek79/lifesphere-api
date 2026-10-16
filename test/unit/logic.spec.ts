import { sniffMime } from '../../src/modules/attachments/attachments.service';
import { maskEmail, maskPhone, normalizeEmail, normalizePhone } from '../../src/common/crypto.service';
import { decodeCursor, encodeCursor } from '../../src/common/pagination';
import { nextOccurrence, parseRule } from '../../src/common/recurrence';
import { quietHoursEnd, zonedTimeToUtc } from '../../src/common/time';
import { chunkText, htmlToText } from '../../src/modules/knowledge/knowledge.service';
import { uuidv7, UUID_RE } from '../../src/common/ids';
import { loadEnv } from '../../src/config/env';

describe('phone & email normalisation', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['+1 415 555 0100', '+14155550100'],
  ])('%s → %s', (input, out) => expect(normalizePhone(input)).toBe(out));
  it('rejects invalid Indian mobiles', () => {
    expect(normalizePhone('1234567890')).toBeNull();
    expect(normalizePhone('+915876543210')).toBeNull();
  });
  it('emails', () => {
    expect(normalizeEmail(' A@B.co ')).toBe('a@b.co');
    expect(normalizeEmail('nope')).toBeNull();
    expect(maskEmail('asha@example.com')).toBe('a***@example.com');
    expect(maskPhone('+919876543210')).toBe('+91******3210');
  });
});

describe('time zones & quiet hours', () => {
  it('converts IST wall clock to UTC', () => {
    expect(zonedTimeToUtc(2026, 10, 16, 9, 0, 'Asia/Kolkata').toISOString()).toBe('2026-10-16T03:30:00.000Z');
  });
  it('detects quiet hours across midnight', () => {
    const at2330 = new Date('2026-10-16T18:00:00Z'); // 23:30 IST
    expect(quietHoursEnd(at2330, '22:00', '07:00', 'Asia/Kolkata')!.toISOString()).toBe('2026-10-17T01:30:00.000Z');
    const atNoon = new Date('2026-10-16T06:30:00Z');
    expect(quietHoursEnd(atNoon, '22:00', '07:00', 'Asia/Kolkata')).toBeNull();
    expect(quietHoursEnd(atNoon, null, null, 'Asia/Kolkata')).toBeNull();
  });
});

describe('recurrence', () => {
  it('next weekly occurrence', () => {
    const start = new Date('2026-11-02T04:30:00Z');
    expect(nextOccurrence('FREQ=WEEKLY;BYDAY=MO,TH', start, start)!.toISOString()).toBe('2026-11-05T04:30:00.000Z');
  });
  it('rejects unsafe rules', () => {
    expect(() => parseRule('FREQ=MINUTELY', new Date())).toThrow();
    expect(() => parseRule('FREQ=DAILY;X=<script>', new Date())).toThrow();
  });
});

describe('pagination cursor', () => {
  it('round-trips and rejects garbage', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const c = decodeCursor(encodeCursor(d, 'abc'));
    expect((c.value as Date).toISOString()).toBe(d.toISOString());
    expect(c.id).toBe('abc');
    expect(() => decodeCursor('###')).toThrow();
  });
});

describe('uploads', () => {
  it('detects real file types from content', () => {
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from('<html>'))).toBeNull();
  });
});

describe('knowledge pipeline', () => {
  it('chunks by heading and size', () => {
    const chunks = chunkText('## A\n\npara one\n\n## B\n\n' + 'x'.repeat(1700), 800);
    expect(chunks[0]).toEqual({ heading: 'A', content: 'para one' });
    expect(chunks.filter((c) => c.heading === 'B').length).toBe(3);
  });
  it('strips scripts and markup from HTML', () => {
    const t = htmlToText('<html><script>evil()</script><h2>Title</h2><p>Hello &amp; welcome</p></html>');
    expect(t).toContain('## Title');
    expect(t).toContain('Hello & welcome');
    expect(t).not.toContain('evil');
  });
});

describe('ids', () => {
  it('uuidv7 is valid and time ordered', () => {
    const a = uuidv7();
    const b = uuidv7();
    expect(a).toMatch(UUID_RE);
    expect(a[14]).toBe('7');
    expect(a.slice(0, 8) <= b.slice(0, 8)).toBe(true);
  });
});

describe('environment safety', () => {
  const base = {
    DATABASE_URL: 'postgres://x',
    JWT_SECRET: 'x'.repeat(40),
    HASH_PEPPER: 'y'.repeat(40),
    ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  };
  it('refuses development shortcuts in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', OTP_DEV_ECHO: 'true' } as NodeJS.ProcessEnv)).toThrow(/OTP_DEV_ECHO/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', WEBHOOK_SECRET: 'a-real-secret-value-123' , THROTTLE_DISABLED: 'true' } as NodeJS.ProcessEnv)).toThrow(/THROTTLE_DISABLED/);
  });
  it('requires provider credentials when a real provider is selected', () => {
    expect(() => loadEnv({ ...base, SMS_PROVIDER: 'msg91' } as NodeJS.ProcessEnv)).toThrow(/MSG91_AUTH_KEY/);
    expect(() => loadEnv({ ...base, ENCRYPTION_KEY: 'short'.repeat(10) } as NodeJS.ProcessEnv)).toThrow(/ENCRYPTION_KEY/);
  });
});
