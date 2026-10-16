/** Time helpers that work in a user's IANA time zone without extra dependencies. */

export function localParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdays.indexOf(parts.weekday as string),
  };
}

/** Offset (ms) of `timeZone` from UTC at instant `date`. */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant for a wall-clock date/time in `timeZone`. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = tzOffsetMs(guess, timeZone);
  const result = new Date(guess.getTime() - offset);
  // Re-check across DST boundaries.
  const offset2 = tzOffsetMs(result, timeZone);
  return offset2 === offset ? result : new Date(guess.getTime() - offset2);
}

export function parseHHMM(t: string): { h: number; m: number } {
  const [h, m] = t.split(':').map(Number);
  return { h, m };
}

/**
 * If `now` falls inside quiet hours [start, end) in the user's zone, returns the instant quiet hours end.
 * Otherwise null. Handles windows that cross midnight (e.g. 22:00-07:00).
 */
export function quietHoursEnd(now: Date, start: string | null, end: string | null, timeZone: string): Date | null {
  if (!start || !end) return null;
  const p = localParts(now, timeZone);
  const cur = p.hour * 60 + p.minute;
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  const sm = s.h * 60 + s.m;
  const em = e.h * 60 + e.m;
  if (sm === em) return null;
  const inside = sm < em ? cur >= sm && cur < em : cur >= sm || cur < em;
  if (!inside) return null;
  let endDay = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (sm > em && cur >= sm) endDay = new Date(endDay.getTime() + 86_400_000);
  return zonedTimeToUtc(endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, endDay.getUTCDate(), e.h, e.m, timeZone);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function addMinutes(d: Date, m: number) {
  return new Date(d.getTime() + m * 60_000);
}

export function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86_400_000);
}

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
