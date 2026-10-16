import { RRule } from 'rrule';
import { badRequest } from './errors';

const ALLOWED_FREQ = new Set([RRule.DAILY, RRule.WEEKLY, RRule.MONTHLY, RRule.YEARLY]);

/** Parse and validate an RFC 5545 RRULE body (without DTSTART), e.g. "FREQ=WEEKLY;BYDAY=MO,TH". */
export function parseRule(rule: string, dtstart: Date): RRule {
  const body = rule.replace(/^RRULE:/i, '').trim();
  if (!/^[A-Z0-9=;,+\-]+$/i.test(body)) throw badRequest('Invalid recurrence rule', 'invalid_recurrence');
  let r: RRule;
  try {
    const opts = RRule.parseString(body);
    if (opts.freq === undefined || !ALLOWED_FREQ.has(opts.freq)) throw new Error('freq');
    if (opts.interval !== undefined && (opts.interval < 1 || opts.interval > 366)) throw new Error('interval');
    r = new RRule({ ...opts, dtstart });
  } catch {
    throw badRequest('Invalid recurrence rule. Use FREQ=DAILY|WEEKLY|MONTHLY|YEARLY with optional INTERVAL, BYDAY, COUNT or UNTIL.', 'invalid_recurrence');
  }
  return r;
}

export function normalizeRule(rule: string): string {
  return rule.replace(/^RRULE:/i, '').trim().toUpperCase();
}

export function nextOccurrence(rule: string, dtstart: Date, after: Date): Date | null {
  return parseRule(rule, dtstart).after(after, false);
}

export function occurrencesBetween(rule: string, dtstart: Date, from: Date, to: Date, max = 200): Date[] {
  return parseRule(rule, dtstart).between(from, to, true).slice(0, max);
}
