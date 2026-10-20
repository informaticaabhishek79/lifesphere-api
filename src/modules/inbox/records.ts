import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Actor } from '../../common/auth-context';
import { zonedTimeToUtc } from '../../common/time';
import type { InboxCreatedItem, InboxSuggestion } from '../../db/schema';
import { CalendarService } from '../calendar/calendar.service';
import { CreateCalendarEventDto } from '../calendar/calendar.controller';
import { CheckInScheduleDto } from '../checkins/checkins.controller';
import { CheckinsService } from '../checkins/checkins.service';
import { CivicDto } from '../community/community.controller';
import { CommunityService } from '../community/community.service';
import { ConsumerCaseDto, PurchaseCreateDto } from '../consumer/consumer.controller';
import { ConsumerService } from '../consumer/consumer.service';
import { BudgetLineDto, CreateListItemDto, InventoryDto, MaintenanceScheduleDto } from '../household-tools/household-tools.controller';
import { HouseholdToolsService } from '../household-tools/household-tools.service';
import { CreateReminderDto } from '../reminders/reminders.controller';
import { RemindersService } from '../reminders/reminders.service';
import { CreateTaskDto } from '../tasks/tasks.dto';
import { TasksService } from '../tasks/tasks.service';
import type { ExtractedItem, ItemType } from './extraction';

export interface RecordServices {
  tasks: TasksService;
  reminders: RemindersService;
  calendar: CalendarService;
  tools: HouseholdToolsService;
  checkins: CheckinsService;
  consumer: ConsumerService;
  community: CommunityService;
}

export interface ApplyContext {
  actor: Actor;
  timeZone: string;
  today: string;
  currency: string;
  householdId: string | null;
  /** App areas the person switched off in Settings. */
  disabled: Set<string>;
  fileName: string;
}

export interface ApplyResult {
  created: InboxCreatedItem[];
  suggestions: InboxSuggestion[];
  skipped: { title: string; reason: string }[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const RRULE = { daily: 'FREQ=DAILY', weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY' } as const;
const CIVIC = ['streetlight', 'garbage', 'road', 'water', 'drainage', 'electricity', 'public_safety', 'other'];
const EVENT_KINDS = ['appointment', 'visit', 'errand', 'activity', 'other'];

/** Which settings switch each kind of item belongs to (Settings → Features). */
const FEATURE: Record<ItemType, string> = {
  task: 'lifeos',
  reminder: 'lifeos',
  event: 'lifeos',
  shopping_item: 'household',
  inventory_item: 'household',
  budget_line: 'household',
  household_note: 'household',
  medicine: 'familycare',
  checkin: 'familycare',
  contact: 'familycare',
  help_info: 'familycare',
  purchase: 'consumer',
  consumer_case: 'consumer',
  civic_issue: 'community',
  community_post: 'community',
  service_request: 'services',
};

const date = (v?: string) => (v && DATE.test(v) ? v : undefined);
const time = (v?: string) => (v && TIME.test(v) ? v : undefined);
const text = (v: string | undefined, max: number) => (v ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Local date + time in the person's time zone → ISO instant. */
export function toInstant(d: string, t: string | undefined, timeZone: string): string {
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = (t ?? '00:00').split(':').map(Number);
  return zonedTimeToUtc(y, m, day, h, min, timeZone).toISOString();
}

async function check<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<T | string> {
  const clean = Object.fromEntries(Object.entries(plain).filter(([, v]) => v !== undefined && v !== ''));
  const obj = plainToInstance(cls, clean);
  const errors = await validate(obj, { whitelist: true, forbidNonWhitelisted: true });
  if (!errors.length) return obj;
  const first = errors[0];
  return `${first.property}: ${Object.values(first.constraints ?? {})[0] ?? 'invalid'}`.slice(0, 120);
}

const message = (e: unknown) => {
  const err = e as { detail?: string; message?: string };
  return (err.detail ?? err.message ?? 'could not be saved').slice(0, 160);
};

/**
 * Turns extracted items into the person's own records using the same services and validation as the app's
 * screens. Nothing here messages, invites or alerts anyone: those become suggestions the person decides on.
 */
export async function applyItems(svc: RecordServices, ctx: ApplyContext, items: ExtractedItem[]): Promise<ApplyResult> {
  const out: ApplyResult = { created: [], suggestions: [], skipped: [] };
  const { actor } = ctx;
  const hh = ctx.householdId ?? undefined;
  const listCache = new Map<string, { id: string; created: boolean; names: Set<string> }>();
  const skip = (title: string | undefined, reason: string) => out.skipped.push({ title: text(title, 120) || '(untitled)', reason });

  const listFor = async (name: string) => {
    const key = name.toLowerCase();
    const cached = listCache.get(key);
    if (cached) return cached;
    const lists = await svc.tools.lists(actor, hh);
    const found = lists.find((l) => l.name.toLowerCase() === key && (hh ? l.householdId === hh : true));
    let entry: { id: string; created: boolean; names: Set<string> };
    if (found) {
      const full = (await svc.tools.getList(actor, found.id)) as unknown as { items?: { name: string; doneAt: string | null }[] };
      entry = { id: found.id, created: false, names: new Set((full.items ?? []).filter((i) => !i.doneAt).map((i) => i.name.toLowerCase())) };
    } else {
      const l = await svc.tools.createList(actor, name.slice(0, 80), hh);
      entry = { id: l.id, created: true, names: new Set() };
    }
    listCache.set(key, entry);
    return entry;
  };

  for (const it of items) {
    const label = it.title ?? it.name;
    if (ctx.disabled.has(FEATURE[it.type])) {
      skip(label, 'This part of the app is switched off in Settings.');
      continue;
    }
    try {
      switch (it.type) {
        case 'task': {
          const d = date(it.date);
          const dto = await check(CreateTaskDto, {
            title: text(it.title ?? it.name, 200),
            notes: text(it.notes, 5000) || undefined,
            priority: it.priority,
            dueAt: d ? toInstant(d, time(it.time) ?? '09:00', ctx.timeZone) : undefined,
            allDay: d && !time(it.time) ? true : undefined,
            recurrenceRule: d && it.repeat ? RRULE[it.repeat] : undefined,
            reminderMinutesBefore: d && it.remind_minutes_before ? Math.round(it.remind_minutes_before) : undefined,
          });
          if (typeof dto === 'string') {
            skip(label, dto);
            break;
          }
          const t = (await svc.tasks.create(actor, dto)) as { id: string };
          out.created.push({ type: 'task', id: t.id, title: dto.title, href: `/tasks/${t.id}` });
          break;
        }
        case 'reminder': {
          const d = date(it.date);
          if (!d) {
            skip(label, 'No date for the reminder.');
            break;
          }
          const fireAt = toInstant(d, time(it.time) ?? '09:00', ctx.timeZone);
          if (new Date(fireAt).getTime() < Date.now()) {
            skip(label, 'The reminder time has already passed.');
            break;
          }
          const dto = await check(CreateReminderDto, { title: text(it.title ?? it.name, 200), fireAt });
          if (typeof dto === 'string') {
            skip(label, dto);
            break;
          }
          const r = await svc.reminders.create(actor.userId, { title: dto.title, fireAt: new Date(dto.fireAt) });
          out.created.push({ type: 'reminder', id: r.id, title: dto.title, href: '/reminders' });
          break;
        }
        case 'event': {
          const d = date(it.date);
          if (!d) {
            skip(label, 'No date for the event.');
            break;
          }
          const start = time(it.time);
          const end = time(it.end_time);
          const kind = EVENT_KINDS.includes(it.category ?? '') ? it.category : undefined;
          const dto = await check(CreateCalendarEventDto, {
            title: text(it.title ?? it.name, 200),
            description: text(it.notes, 4000) || undefined,
            kind,
            startsAt: toInstant(d, start ?? '00:00', ctx.timeZone),
            endsAt: start && end && end > start ? toInstant(d, end, ctx.timeZone) : undefined,
            allDay: start ? undefined : true,
            locationText: text(it.location, 200) || undefined,
            recurrenceRule: it.repeat ? RRULE[it.repeat] : undefined,
            reminderMinutesBefore: start ? Math.round(it.remind_minutes_before ?? 60) : undefined,
          });
          if (typeof dto === 'string') {
            skip(label, dto);
            break;
          }
          const e = (await svc.calendar.create(actor, dto)) as { id: string };
          out.created.push({ type: 'event', id: e.id, title: dto.title, href: `/calendar?date=${d}` });
          break;
        }
        case 'shopping_item': {
          const name = text(it.name ?? it.title, 120);
          const dto = await check(CreateListItemDto, {
            name,
            quantity: typeof it.quantity === 'number' && it.quantity > 0 ? it.quantity : undefined,
            unit: text(it.unit, 20) || undefined,
            category: text(it.category, 40) || undefined,
          });
          if (typeof dto === 'string') {
            skip(name, dto);
            break;
          }
          const list = await listFor(text(it.list_name, 80) || 'Shopping list');
          if (list.names.has(name.toLowerCase())) {
            skip(name, 'Already on the list.');
            break;
          }
          const item = (await svc.tools.addItem(actor, list.id, dto)) as { id: string };
          list.names.add(name.toLowerCase());
          out.created.push({ type: 'shopping_item', id: item.id, title: name, href: `/lists/${list.id}`, parentId: list.id, parentCreated: list.created });
          break;
        }
        case 'inventory_item': {
          const dto = await check(InventoryDto, {
            name: text(it.name ?? it.title, 120),
            category: text(it.category, 40).toLowerCase() || 'other',
            brand: text(it.brand, 60) || undefined,
            model: text(it.model, 80) || undefined,
            roomOrLocation: text(it.location, 60) || undefined,
            purchaseDate: date(it.purchase_date),
            warrantyExpiresOn: date(it.warranty_until),
            notes: text(it.notes, 2000) || undefined,
            householdId: hh,
          });
          if (typeof dto === 'string') {
            skip(label, dto);
            break;
          }
          const inv = (await svc.tools.createItem(actor, dto)) as { id: string };
          out.created.push({ type: 'inventory_item', id: inv.id, title: dto.name, href: `/inventory/${inv.id}` });
          if (it.maintenance_title && it.maintenance_every_days && date(it.maintenance_next_due)) {
            const sched = await check(MaintenanceScheduleDto, {
              title: text(it.maintenance_title, 120),
              intervalDays: Math.round(it.maintenance_every_days),
              nextDueOn: date(it.maintenance_next_due),
            });
            if (typeof sched !== 'string') {
              const s = (await svc.tools.addSchedule(actor, inv.id, sched)) as { id: string };
              out.created.push({ type: 'maintenance', id: s.id, title: sched.title, href: `/inventory/${inv.id}`, parentId: inv.id, parentCreated: true });
            }
          }
          break;
        }
        case 'budget_line': {
          const m = it.month && /^\d{4}-\d{2}$/.test(it.month) ? `${it.month}-01` : `${ctx.today.slice(0, 7)}-01`;
          const dto = await check(BudgetLineDto, {
            month: m,
            category: text(it.name ?? it.category ?? it.title, 40),
            plannedAmount: typeof it.planned === 'number' && it.planned >= 0 ? it.planned : 0,
            spentAmount: typeof it.spent === 'number' && it.spent >= 0 ? it.spent : undefined,
            currency: it.currency && /^[A-Z]{3}$/.test(it.currency) ? it.currency : undefined,
            note: text(it.notes, 200) || undefined,
            householdId: hh,
          });
          if (typeof dto === 'string') {
            skip(label, dto);
            break;
          }
          const existing = (await svc.tools.budgets(actor, m, hh)) as { category: string }[];
          if (existing.some((b) => b.category.toLowerCase() === dto.category.toLowerCase())) {
            skip(dto.category, 'This budget category already exists for that month; it was not changed.');
            break;
          }
          const b = (await svc.tools.createBudget(actor, dto)) as { id: string };
          out.created.push({ type: 'budget_line', id: b.id, title: `${dto.category} (${m.slice(0, 7)})`, href: `/budgets?month=${m}` });
          break;
        }
        case 'medicine':
        case 'checkin': {
          const times = (it.times?.length ? it.times : it.time ? [it.time] : []).map((x) => time(String(x))).filter((x): x is string => !!x);
          if (!times.length) {
            skip(label, 'No time given.');
            break;
          }
          const days = (it.days_of_week ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
          for (const t of [...new Set(times)].slice(0, 6)) {
            const dto = await check(CheckInScheduleDto, {
              label: text(it.name ?? it.title ?? (it.type === 'medicine' ? 'Medicine' : 'Check-in'), 80),
              purpose: it.type === 'medicine' ? 'medicine' : 'wellbeing',
              kind: days.length && days.length < 7 ? 'weekly' : 'daily',
              timeLocal: t,
              daysOfWeek: days.length && days.length < 7 ? days : undefined,
              timezone: ctx.timeZone,
              // Contacts are never alerted from an imported file; the person turns that on themselves.
              escalate: false,
            });
            if (typeof dto === 'string') {
              skip(label, dto);
              continue;
            }
            const sc = (await svc.checkins.create(actor, dto)) as { id: string } | undefined;
            if (sc) out.created.push({ type: it.type, id: sc.id, title: `${dto.label} at ${t}`, href: '/check-ins' });
          }
          break;
        }
        case 'purchase': {
          const dto = await check(PurchaseCreateDto, {
            productCategory: text(it.name ?? it.title ?? it.category, 60),
            brand: text(it.brand, 60) || undefined,
            model: text(it.model, 80) || undefined,
            purchaseDate: date(it.purchase_date ?? it.date),
            retailerName: text(it.retailer ?? it.company, 120) || undefined,
            warrantyExpiresOn: date(it.warranty_until),
            returnDeadline: date(it.return_by),
            notes: text(it.notes, 2000) || undefined,
          });
          if (typeof dto === 'string') {
            skip(label, dto);
            break;
          }
          const p = (await svc.consumer.createPurchase(actor, dto)) as { id: string };
          out.created.push({ type: 'purchase', id: p.id, title: dto.productCategory, href: '/consumer' });
          break;
        }
        case 'consumer_case': {
          const dto = await check(ConsumerCaseDto, {
            title: text(it.title ?? it.name, 200),
            description: text(it.notes, 4000) || undefined,
            counterpartyName: text(it.company, 120) || undefined,
            nextFollowUpOn: date(it.date),
          });
          if (typeof dto === 'string') {
            skip(label, dto);
            break;
          }
          const c = (await svc.consumer.createCase(actor, dto)) as { id: string };
          out.created.push({ type: 'consumer_case', id: c.id, title: dto.title, href: `/consumer/cases/${c.id}` });
          break;
        }
        case 'civic_issue': {
          const dto = await check(CivicDto, {
            category: CIVIC.includes((it.category ?? '').toLowerCase()) ? it.category!.toLowerCase() : 'other',
            description: text(it.notes ?? it.title ?? it.name, 1000),
            locationText: text(it.location, 200) || undefined,
          });
          if (typeof dto === 'string') {
            skip(label, dto);
            break;
          }
          const c = (await svc.community.civicCreate(actor, dto)) as { id: string };
          out.created.push({ type: 'civic_issue', id: c.id, title: dto.description.slice(0, 80), href: '/civic' });
          break;
        }
        // Anything that would reach other people is only suggested.
        case 'contact':
          out.suggestions.push({
            type: 'contact',
            title: text(it.name ?? it.title, 120) || 'Contact',
            details: [it.relation, it.phone, it.email, it.notes].filter(Boolean).map((x) => text(x, 200)).join(' · '),
            href: '/contacts',
          });
          break;
        case 'community_post':
          out.suggestions.push({ type: 'community_post', title: text(it.title, 120) || 'Post for your group', details: text(it.notes ?? it.title, 2000), href: '/community' });
          break;
        case 'help_info':
          out.suggestions.push({ type: 'help_info', title: text(it.title ?? it.name, 120) || 'Help details', details: [it.phone, it.notes].filter(Boolean).map((x) => text(x, 500)).join(' · '), href: '/help' });
          break;
        case 'service_request':
          out.suggestions.push({
            type: 'service_request',
            title: text(it.title ?? it.name, 120) || 'Service',
            details: [it.notes, it.date ? `Preferred date ${it.date}` : ''].filter(Boolean).map((x) => text(x, 500)).join(' · '),
            href: '/services',
          });
          break;
        case 'household_note':
          out.suggestions.push({ type: 'household_note', title: text(it.title, 120) || 'Household note', details: text(it.notes ?? it.title, 2000), href: '/households' });
          break;
      }
    } catch (e) {
      skip(label, message(e));
    }
  }
  return out;
}

/** Removes what an import created. Things already gone, or changed hands, are left alone. */
export async function undoItems(svc: RecordServices, actor: Actor, created: InboxCreatedItem[]): Promise<number> {
  let removed = 0;
  const lists = new Set<string>();
  const ignore = () => undefined;
  for (const c of [...created].reverse()) {
    try {
      switch (c.type) {
        case 'task':
          await svc.tasks.remove(actor, c.id);
          break;
        case 'reminder':
          await svc.reminders.cancel(actor, c.id);
          break;
        case 'event':
          await svc.calendar.remove(actor, c.id);
          break;
        case 'shopping_item':
          await svc.tools.deleteItem(actor, c.id);
          if (c.parentId && c.parentCreated) lists.add(c.parentId);
          break;
        case 'maintenance':
          if (c.parentId) await svc.tools.deleteSchedule(actor, c.parentId, c.id).catch(ignore);
          break;
        case 'inventory_item':
          await svc.tools.deleteInvItem(actor, c.id);
          break;
        case 'budget_line':
          await svc.tools.deleteBudget(actor, c.id);
          break;
        case 'medicine':
        case 'checkin':
          await svc.checkins.remove(actor, c.id);
          break;
        case 'purchase':
          await svc.consumer.deletePurchase(actor, c.id);
          break;
        case 'consumer_case':
          await svc.consumer.deleteCase(actor, c.id);
          break;
        case 'civic_issue':
          await svc.community.civicDelete(actor, c.id);
          break;
        default:
          continue;
      }
      removed++;
    } catch {
      /* already removed or no longer theirs */
    }
  }
  // A list this import made is removed too, unless the person has since added their own items to it.
  for (const id of lists) {
    try {
      const l = (await svc.tools.getList(actor, id)) as unknown as { items?: unknown[] };
      if (!l.items?.length) await svc.tools.deleteList(actor, id);
    } catch {
      /* gone */
    }
  }
  return removed;
}
