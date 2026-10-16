import { Inject, Injectable } from '@nestjs/common';
import { and, asc, avg, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit.service';
import { Actor } from '../../common/auth-context';
import { escapeLike } from '../../common/dto';
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../common/errors';
import { CursorQuery, keyset, lim, pageOf } from '../../common/pagination';
import { PolicyService } from '../../common/policy.service';
import { Database, DB } from '../../db/db';
import {
  consumerCases,
  homeInventoryItems,
  localities,
  providerMembers,
  providerReviews,
  providerServiceAreas,
  providerServices,
  providerVerificationRecords,
  serviceCategories,
  serviceProviders,
  serviceRequestEvents,
  serviceRequests,
  userProfiles,
} from '../../db/schema';
import { InviteHelper } from '../households/households.service';
import { ModerationService } from '../moderation/moderation.service';
import { NotificationsService } from '../notifications/notifications.service';

type ReqStatus = 'requested' | 'accepted' | 'declined' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'disputed';
type Provider = typeof serviceProviders.$inferSelect;

export const VERIFICATION_LABELS = {
  none: 'Not verified by LifeSphere',
  basic: 'Identity checked by LifeSphere',
  screened: 'Background-screened through a LifeSphere partner',
} as const;

/** Who may move a request to which status. */
const PROVIDER_MOVES: Partial<Record<ReqStatus, ReqStatus[]>> = {
  requested: ['accepted', 'declined'],
  accepted: ['scheduled', 'in_progress', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
};
const CUSTOMER_MOVES: Partial<Record<ReqStatus, ReqStatus[]>> = {
  requested: ['cancelled'],
  accepted: ['cancelled'],
  scheduled: ['cancelled'],
  in_progress: ['disputed'],
  completed: ['disputed'],
};

@Injectable()
export class ServicesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly moderation: ModerationService,
    private readonly people: InviteHelper,
  ) {}

  // ------------------------------------------------------------------ directory (customers)
  async categories() {
    return this.db.select().from(serviceCategories).where(eq(serviceCategories.active, true)).orderBy(asc(serviceCategories.sortOrder), asc(serviceCategories.name));
  }

  private present(p: Provider) {
    return {
      id: p.id,
      displayName: p.displayName,
      providerType: p.providerType,
      description: p.description,
      phonePublic: p.phonePublic,
      emailPublic: p.emailPublic,
      websiteUrl: p.websiteUrl,
      verificationLevel: p.verificationLevel,
      verificationLabel: VERIFICATION_LABELS[p.verificationLevel],
      // Paid placement is always disclosed and never implies verification.
      sponsored: p.isSponsored && (!p.sponsoredUntil || p.sponsoredUntil > new Date()),
      sponsoredDisclosure: p.isSponsored ? 'Sponsored listing. Payment does not affect verification.' : null,
    };
  }

  async directory(actor: Actor, q: CursorQuery & { categoryId?: string; localityId?: string; search?: string; verifiedOnly?: boolean }) {
    const limit = lim(q);
    const [profile] = await this.db.select({ l: userProfiles.localityId }).from(userProfiles).where(eq(userProfiles.userId, actor.userId));
    const locality = q.localityId ?? profile?.l ?? null;
    const inCategory = q.categoryId
      ? this.db.select({ id: providerServices.providerId }).from(providerServices).where(and(eq(providerServices.categoryId, q.categoryId), eq(providerServices.active, true)))
      : null;
    const inArea = locality ? this.db.select({ id: providerServiceAreas.providerId }).from(providerServiceAreas).where(eq(providerServiceAreas.localityId, locality)) : null;
    const rows = await this.db
      .select()
      .from(serviceProviders)
      .where(
        and(
          eq(serviceProviders.status, 'active'),
          inCategory ? inArray(serviceProviders.id, inCategory) : undefined,
          inArea ? inArray(serviceProviders.id, inArea) : undefined,
          q.search ? ilike(serviceProviders.displayName, `%${escapeLike(q.search)}%`) : undefined,
          q.verifiedOnly ? ne(serviceProviders.verificationLevel, 'none') : undefined,
          keyset(serviceProviders.createdAt, serviceProviders.id, q.cursor),
        ),
      )
      .orderBy(desc(serviceProviders.createdAt), desc(serviceProviders.id))
      .limit(limit + 1);
    const page = pageOf(rows, limit, (r) => [r.createdAt, r.id]);
    const ids = page.items.map((p) => p.id);
    const ratings = ids.length
      ? await this.db
          .select({ providerId: providerReviews.providerId, avg: avg(providerReviews.rating), n: count() })
          .from(providerReviews)
          .where(and(inArray(providerReviews.providerId, ids), eq(providerReviews.status, 'published')))
          .groupBy(providerReviews.providerId)
      : [];
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((p) => {
        const r = ratings.find((x) => x.providerId === p.id);
        return { ...this.present(p), rating: r ? { average: Number(Number(r.avg).toFixed(1)), count: r.n } : null };
      }),
      disclosure: 'Listings are not endorsements. Sponsored listings are labelled. Check verification labels before inviting anyone into your home.',
    };
  }

  async provider(actor: Actor, id: string) {
    const [p] = await this.db.select().from(serviceProviders).where(eq(serviceProviders.id, id));
    const isMember = p ? !!(await this.policy.providerRole(actor.userId, id)) : false;
    if (!p || (p.status !== 'active' && !isMember)) throw notFound('Provider');
    const services = await this.db
      .select({ id: providerServices.id, title: providerServices.title, description: providerServices.description, priceNote: providerServices.priceNote, categoryId: providerServices.categoryId, categoryName: serviceCategories.name })
      .from(providerServices)
      .innerJoin(serviceCategories, eq(serviceCategories.id, providerServices.categoryId))
      .where(and(eq(providerServices.providerId, id), eq(providerServices.active, true)));
    const areas = await this.db
      .select({ id: localities.id, name: localities.name, city: localities.city })
      .from(providerServiceAreas)
      .innerJoin(localities, eq(localities.id, providerServiceAreas.localityId))
      .where(eq(providerServiceAreas.providerId, id));
    const [r] = await this.db.select({ avg: avg(providerReviews.rating), n: count() }).from(providerReviews).where(and(eq(providerReviews.providerId, id), eq(providerReviews.status, 'published')));
    const checks = await this.db
      .select({ checkType: providerVerificationRecords.checkType, status: providerVerificationRecords.status, checkedAt: providerVerificationRecords.checkedAt, expiresAt: providerVerificationRecords.expiresAt })
      .from(providerVerificationRecords)
      .where(and(eq(providerVerificationRecords.providerId, id), eq(providerVerificationRecords.status, 'passed')));
    return { ...this.present(p), status: isMember ? p.status : undefined, services, areas, verificationChecks: checks, rating: r?.n ? { average: Number(Number(r.avg).toFixed(1)), count: r.n } : null };
  }

  async reviews(actor: Actor, providerId: string, q: CursorQuery) {
    const limit = lim(q);
    const rows = await this.db
      .select({ id: providerReviews.id, rating: providerReviews.rating, body: providerReviews.body, providerResponse: providerReviews.providerResponse, createdAt: providerReviews.createdAt, reviewerName: userProfiles.displayName })
      .from(providerReviews)
      .innerJoin(userProfiles, eq(userProfiles.userId, providerReviews.reviewerId))
      .where(and(eq(providerReviews.providerId, providerId), eq(providerReviews.status, 'published'), keyset(providerReviews.createdAt, providerReviews.id, q.cursor)))
      .orderBy(desc(providerReviews.createdAt), desc(providerReviews.id))
      .limit(limit + 1);
    return pageOf(rows, limit, (r) => [r.createdAt, r.id]);
  }

  // ------------------------------------------------------------------ provider portal
  async myProviders(actor: Actor) {
    return this.db
      .select({ provider: serviceProviders, role: providerMembers.role })
      .from(providerMembers)
      .innerJoin(serviceProviders, eq(serviceProviders.id, providerMembers.providerId))
      .where(eq(providerMembers.userId, actor.userId));
  }

  async createProvider(actor: Actor, dto: { displayName: string; providerType: 'individual' | 'business' | 'volunteer' | 'organisation'; description?: string; phonePublic?: string; emailPublic?: string; websiteUrl?: string }) {
    await this.moderation.assertCanPost(actor.userId);
    const mine = await this.myProviders(actor);
    if (mine.length >= 5) throw unprocessable('You can manage up to 5 provider profiles', 'provider_limit');
    return this.db.transaction(async (tx) => {
      const [p] = await tx.insert(serviceProviders).values({ ...dto, createdBy: actor.userId, status: 'draft' }).returning();
      await tx.insert(providerMembers).values({ providerId: p.id, userId: actor.userId, role: 'owner' });
      await this.audit.record(actor, { action: 'provider.created', targetType: 'provider', targetId: p.id }, tx);
      return p;
    });
  }

  async portalGet(actor: Actor, id: string) {
    const role = await this.policy.requireProviderMember(actor.userId, id);
    const [p] = await this.db.select().from(serviceProviders).where(eq(serviceProviders.id, id));
    const verification = await this.db.select().from(providerVerificationRecords).where(eq(providerVerificationRecords.providerId, id)).orderBy(desc(providerVerificationRecords.createdAt));
    const members = await this.db
      .select({ userId: providerMembers.userId, role: providerMembers.role, displayName: userProfiles.displayName })
      .from(providerMembers)
      .innerJoin(userProfiles, eq(userProfiles.userId, providerMembers.userId))
      .where(eq(providerMembers.providerId, id));
    const services = await this.db.select().from(providerServices).where(eq(providerServices.providerId, id));
    const areas = await this.db.select({ localityId: providerServiceAreas.localityId }).from(providerServiceAreas).where(eq(providerServiceAreas.providerId, id));
    return { ...p, myRole: role, verificationLabel: VERIFICATION_LABELS[p.verificationLevel], verification, members, services, areaLocalityIds: areas.map((a) => a.localityId) };
  }

  async updateProvider(actor: Actor, id: string, dto: { displayName?: string; description?: string; phonePublic?: string; emailPublic?: string; websiteUrl?: string }) {
    await this.policy.requireProviderMember(actor.userId, id, true);
    const [p] = await this.db.update(serviceProviders).set(dto).where(eq(serviceProviders.id, id)).returning();
    return p;
  }

  async submitForReview(actor: Actor, id: string) {
    await this.policy.requireProviderMember(actor.userId, id, true);
    const [p] = await this.db.select().from(serviceProviders).where(eq(serviceProviders.id, id));
    if (!['draft', 'rejected'].includes(p.status)) throw unprocessable('Only draft or rejected profiles can be submitted');
    const [{ n: services }] = await this.db.select({ n: count() }).from(providerServices).where(and(eq(providerServices.providerId, id), eq(providerServices.active, true)));
    const [{ n: areas }] = await this.db.select({ n: count() }).from(providerServiceAreas).where(eq(providerServiceAreas.providerId, id));
    if (!services || !areas) throw unprocessable('Add at least one service and one service area first', 'profile_incomplete');
    const [u] = await this.db.update(serviceProviders).set({ status: 'pending_review', submittedAt: new Date(), rejectionReason: null }).where(eq(serviceProviders.id, id)).returning();
    await this.audit.record(actor, { action: 'provider.submitted', targetType: 'provider', targetId: id });
    return u;
  }

  async addService(actor: Actor, providerId: string, dto: { categoryId: string; title: string; description?: string; priceNote?: string }) {
    await this.policy.requireProviderMember(actor.userId, providerId, true);
    const [cat] = await this.db.select().from(serviceCategories).where(and(eq(serviceCategories.id, dto.categoryId), eq(serviceCategories.active, true)));
    if (!cat) throw notFound('Category');
    const [s] = await this.db.insert(providerServices).values({ providerId, ...dto }).returning();
    return { ...s, note: cat.requiresVerification || cat.seniorSupport ? `This category needs ${cat.seniorSupport ? 'background screening' : 'identity verification'} before you can accept requests.` : undefined };
  }

  async updateService(actor: Actor, providerId: string, serviceId: string, dto: { title?: string; description?: string; priceNote?: string; active?: boolean }) {
    await this.policy.requireProviderMember(actor.userId, providerId, true);
    const [s] = await this.db.update(providerServices).set(dto).where(and(eq(providerServices.id, serviceId), eq(providerServices.providerId, providerId))).returning();
    if (!s) throw notFound('Service');
    return s;
  }

  async deleteService(actor: Actor, providerId: string, serviceId: string) {
    await this.policy.requireProviderMember(actor.userId, providerId, true);
    const res = await this.db.update(providerServices).set({ active: false }).where(and(eq(providerServices.id, serviceId), eq(providerServices.providerId, providerId))).returning();
    if (!res.length) throw notFound('Service');
  }

  async setAreas(actor: Actor, providerId: string, localityIds: string[]) {
    await this.policy.requireProviderMember(actor.userId, providerId, true);
    const found = localityIds.length ? await this.db.select({ id: localities.id }).from(localities).where(inArray(localities.id, localityIds)) : [];
    if (found.length !== new Set(localityIds).size) throw notFound('Locality');
    await this.db.transaction(async (tx) => {
      await tx.delete(providerServiceAreas).where(eq(providerServiceAreas.providerId, providerId));
      if (localityIds.length) await tx.insert(providerServiceAreas).values([...new Set(localityIds)].map((localityId) => ({ providerId, localityId })));
    });
    return { localityIds: [...new Set(localityIds)] };
  }

  async addMember(actor: Actor, providerId: string, userId: string, role: 'owner' | 'staff') {
    await this.policy.requireProviderMember(actor.userId, providerId, true);
    if (!(await this.policy.isTrustedContact(actor.userId, userId)) && !(await this.policy.shareHousehold(actor.userId, userId))) {
      throw notFound('User');
    }
    await this.db.insert(providerMembers).values({ providerId, userId, role }).onConflictDoUpdate({ target: [providerMembers.providerId, providerMembers.userId], set: { role } });
    await this.audit.record(actor, { action: 'provider.member_added', targetType: 'provider', targetId: providerId, subjectUserId: userId, metadata: { role } });
    return { userId, role };
  }

  async removeMember(actor: Actor, providerId: string, userId: string) {
    await this.policy.requireProviderMember(actor.userId, providerId, userId !== actor.userId);
    const owners = await this.db.select().from(providerMembers).where(and(eq(providerMembers.providerId, providerId), eq(providerMembers.role, 'owner')));
    if (owners.length === 1 && owners[0].userId === userId) throw unprocessable('Add another owner first', 'last_owner');
    await this.db.delete(providerMembers).where(and(eq(providerMembers.providerId, providerId), eq(providerMembers.userId, userId)));
  }

  // ------------------------------------------------------------------ service requests
  private async checkProviderEligible(providerId: string, categoryId: string) {
    const [p] = await this.db.select().from(serviceProviders).where(eq(serviceProviders.id, providerId));
    if (!p || p.status !== 'active') throw notFound('Provider');
    const [svc] = await this.db.select().from(providerServices).where(and(eq(providerServices.providerId, providerId), eq(providerServices.categoryId, categoryId), eq(providerServices.active, true))).limit(1);
    if (!svc) throw unprocessable('This provider does not offer that service', 'service_not_offered');
    const [cat] = await this.db.select().from(serviceCategories).where(eq(serviceCategories.id, categoryId));
    if (cat?.seniorSupport && p.verificationLevel !== 'screened') throw new AppError(422, 'verification_required', 'In-home senior support needs a background-screened provider.');
    if (cat?.requiresVerification && p.verificationLevel === 'none') throw new AppError(422, 'verification_required', 'This service needs a verified provider.');
    return p;
  }

  async createRequest(
    actor: Actor,
    dto: {
      categoryId: string;
      providerId?: string;
      providerServiceId?: string;
      title: string;
      description?: string;
      localityId?: string;
      locationNote?: string;
      preferredStart?: string;
      preferredEnd?: string;
      inventoryItemId?: string;
      consumerCaseId?: string;
      onBehalfOfUserId?: string;
    },
  ) {
    const [cat] = await this.db.select().from(serviceCategories).where(and(eq(serviceCategories.id, dto.categoryId), eq(serviceCategories.active, true)));
    if (!cat) throw notFound('Category');
    if (dto.providerId) await this.checkProviderEligible(dto.providerId, dto.categoryId);
    if (dto.providerServiceId) {
      const [s] = await this.db.select().from(providerServices).where(and(eq(providerServices.id, dto.providerServiceId), eq(providerServices.providerId, dto.providerId ?? '00000000-0000-0000-0000-000000000000')));
      if (!s) throw notFound('Service');
    }
    if (dto.onBehalfOfUserId && !(await this.policy.isTrustedContact(dto.onBehalfOfUserId, actor.userId))) throw notFound('Contact');
    if (dto.inventoryItemId) {
      const [i] = await this.db.select().from(homeInventoryItems).where(eq(homeInventoryItems.id, dto.inventoryItemId));
      if (!i || !(i.ownerUserId === actor.userId || (i.householdId && (await this.policy.householdRole(actor.userId, i.householdId))))) throw notFound('Inventory item');
    }
    if (dto.consumerCaseId) {
      const [c] = await this.db.select().from(consumerCases).where(and(eq(consumerCases.id, dto.consumerCaseId), eq(consumerCases.ownerUserId, actor.userId)));
      if (!c) throw notFound('Case');
    }
    const [profile] = await this.db.select({ l: userProfiles.localityId }).from(userProfiles).where(eq(userProfiles.userId, actor.userId));
    const [r] = await this.db
      .insert(serviceRequests)
      .values({
        requesterId: actor.userId,
        onBehalfOfUserId: dto.onBehalfOfUserId,
        providerId: dto.providerId,
        providerServiceId: dto.providerServiceId,
        categoryId: dto.categoryId,
        title: dto.title,
        description: dto.description,
        localityId: dto.localityId ?? profile?.l ?? null,
        locationNote: dto.locationNote,
        preferredStart: dto.preferredStart ? new Date(dto.preferredStart) : null,
        preferredEnd: dto.preferredEnd ? new Date(dto.preferredEnd) : null,
        inventoryItemId: dto.inventoryItemId,
        consumerCaseId: dto.consumerCaseId,
      })
      .returning();
    await this.db.insert(serviceRequestEvents).values({ requestId: r.id, actorId: actor.userId, fromStatus: null, toStatus: 'requested' });
    if (dto.providerId) await this.notifyProvider(dto.providerId, `New service request: ${dto.title}`, r.id);
    if (dto.onBehalfOfUserId) {
      const name = await this.people.displayName(actor.userId);
      await this.notifications.notify({ userId: dto.onBehalfOfUserId, category: 'services', template: 'service_on_behalf', title: `${name} requested "${dto.title}" for you`, data: { type: 'service_request', id: r.id } });
    }
    await this.audit.record(actor, { action: 'service_request.created', targetType: 'service_request', targetId: r.id });
    return this.requestDetail(actor, r.id);
  }

  private async notifyProvider(providerId: string, title: string, requestId: string) {
    const members = await this.db.select({ u: providerMembers.userId }).from(providerMembers).where(eq(providerMembers.providerId, providerId));
    for (const m of members) await this.notifications.notify({ userId: m.u, category: 'services', template: 'provider_request', title, data: { type: 'service_request', id: requestId }, channels: ['push', 'sms'], smsText: 'LifeSphere: you have a new service request' });
  }

  private async load(id: string) {
    const [r] = await this.db.select().from(serviceRequests).where(eq(serviceRequests.id, id));
    if (!r) throw notFound('Service request');
    return r;
  }

  private async roleOn(actor: Actor, r: typeof serviceRequests.$inferSelect): Promise<'customer' | 'provider' | null> {
    if (r.requesterId === actor.userId || r.onBehalfOfUserId === actor.userId) return 'customer';
    if (r.providerId && (await this.policy.providerRole(actor.userId, r.providerId))) return 'provider';
    return null;
  }

  async requestDetail(actor: Actor, id: string) {
    const r = await this.load(id);
    const role = await this.roleOn(actor, r);
    if (!role) throw notFound('Service request');
    const events = await this.db.select().from(serviceRequestEvents).where(eq(serviceRequestEvents.requestId, id)).orderBy(asc(serviceRequestEvents.createdAt));
    const [provider] = r.providerId ? await this.db.select().from(serviceProviders).where(eq(serviceProviders.id, r.providerId)) : [];
    const [review] = await this.db.select().from(providerReviews).where(eq(providerReviews.requestId, id));
    const revealLocation = role === 'customer' || ['accepted', 'scheduled', 'in_progress', 'completed', 'disputed'].includes(r.status);
    return {
      ...r,
      locationNote: revealLocation ? r.locationNote : null,
      myRole: role,
      allowedNextStatuses: (role === 'provider' ? PROVIDER_MOVES : CUSTOMER_MOVES)[r.status] ?? [],
      provider: provider ? this.present(provider) : null,
      history: events,
      review: review ?? null,
    };
  }

  async myRequests(actor: Actor, q: CursorQuery & { status?: string }) {
    const limit = lim(q);
    const rows = await this.db
      .select()
      .from(serviceRequests)
      .where(
        and(
          or(eq(serviceRequests.requesterId, actor.userId), eq(serviceRequests.onBehalfOfUserId, actor.userId)),
          q.status ? eq(serviceRequests.status, q.status as ReqStatus) : undefined,
          keyset(serviceRequests.createdAt, serviceRequests.id, q.cursor),
        ),
      )
      .orderBy(desc(serviceRequests.createdAt), desc(serviceRequests.id))
      .limit(limit + 1);
    return pageOf(rows, limit, (r) => [r.createdAt, r.id]);
  }

  async updateRequest(actor: Actor, id: string, dto: { title?: string; description?: string; locationNote?: string; preferredStart?: string; preferredEnd?: string }) {
    const r = await this.load(id);
    if (r.requesterId !== actor.userId) throw notFound('Service request');
    if (r.status !== 'requested') throw unprocessable('Requests can only be edited before a provider accepts');
    const [u] = await this.db
      .update(serviceRequests)
      .set({
        ...(dto.title ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.locationNote !== undefined ? { locationNote: dto.locationNote } : {}),
        ...(dto.preferredStart ? { preferredStart: new Date(dto.preferredStart) } : {}),
        ...(dto.preferredEnd ? { preferredEnd: new Date(dto.preferredEnd) } : {}),
      })
      .where(eq(serviceRequests.id, id))
      .returning();
    return u;
  }

  /** Status change by the customer or the provider, recorded in the append-only history. */
  async transition(actor: Actor, id: string, to: ReqStatus, opts: { note?: string; scheduledAt?: string } = {}) {
    const r = await this.load(id);
    const role = await this.roleOn(actor, r);
    if (!role) throw notFound('Service request');
    const allowed = (role === 'provider' ? PROVIDER_MOVES : CUSTOMER_MOVES)[r.status] ?? [];
    if (!allowed.includes(to)) throw unprocessable(`Cannot change from ${r.status} to ${to}`, 'invalid_transition');
    if (to === 'accepted' && r.providerId) await this.checkProviderEligible(r.providerId, r.categoryId);
    if (to === 'scheduled' && !opts.scheduledAt) throw badRequest('scheduledAt is required', 'schedule_required');
    if (to === 'disputed' && !opts.note) throw badRequest('Please describe the problem', 'note_required');
    const [u] = await this.db
      .update(serviceRequests)
      .set({
        status: to,
        statusReason: opts.note ?? null,
        ...(to === 'scheduled' ? { scheduledAt: new Date(opts.scheduledAt!) } : {}),
        ...(to === 'completed' ? { completedAt: new Date() } : {}),
      })
      .where(and(eq(serviceRequests.id, id), eq(serviceRequests.status, r.status)))
      .returning();
    if (!u) throw conflict('The request changed meanwhile; refresh and try again', 'stale_state');
    await this.db.insert(serviceRequestEvents).values({ requestId: id, actorId: actor.userId, fromStatus: r.status, toStatus: to, note: opts.note });
    const recipients = role === 'provider' ? [r.requesterId, r.onBehalfOfUserId].filter((x): x is string => !!x) : [];
    for (const uid of recipients) {
      await this.notifications.notify({ userId: uid, category: 'services', template: `service_${to}`, title: `"${r.title}" is now ${to.replace('_', ' ')}`, data: { type: 'service_request', id } });
    }
    if (role === 'customer' && r.providerId) await this.notifyProvider(r.providerId, `"${r.title}" was ${to}`, id);
    await this.audit.record(actor, { action: `service_request.${to}`, targetType: 'service_request', targetId: id });
    return this.requestDetail(actor, id);
  }

  // ------------------------------------------------------------------ provider inbox
  async providerRequests(actor: Actor, providerId: string, q: CursorQuery & { status?: string }) {
    await this.policy.requireProviderMember(actor.userId, providerId);
    const limit = lim(q);
    const rows = await this.db
      .select()
      .from(serviceRequests)
      .where(and(eq(serviceRequests.providerId, providerId), q.status ? eq(serviceRequests.status, q.status as ReqStatus) : undefined, keyset(serviceRequests.createdAt, serviceRequests.id, q.cursor)))
      .orderBy(desc(serviceRequests.createdAt), desc(serviceRequests.id))
      .limit(limit + 1);
    const page = pageOf(rows, limit, (r) => [r.createdAt, r.id]);
    return { ...page, items: page.items.map((r) => ({ ...r, locationNote: r.status === 'requested' ? null : r.locationNote })) };
  }

  /** Unassigned requests in this provider's categories and areas. Location stays hidden until claimed. */
  async openRequests(actor: Actor, providerId: string) {
    await this.policy.requireProviderMember(actor.userId, providerId);
    const cats = this.db.select({ id: providerServices.categoryId }).from(providerServices).where(and(eq(providerServices.providerId, providerId), eq(providerServices.active, true)));
    const areas = this.db.select({ id: providerServiceAreas.localityId }).from(providerServiceAreas).where(eq(providerServiceAreas.providerId, providerId));
    const rows = await this.db
      .select({ id: serviceRequests.id, title: serviceRequests.title, description: serviceRequests.description, categoryId: serviceRequests.categoryId, localityId: serviceRequests.localityId, preferredStart: serviceRequests.preferredStart, preferredEnd: serviceRequests.preferredEnd, createdAt: serviceRequests.createdAt })
      .from(serviceRequests)
      .where(and(isNull(serviceRequests.providerId), eq(serviceRequests.status, 'requested'), inArray(serviceRequests.categoryId, cats), inArray(serviceRequests.localityId, areas)))
      .orderBy(desc(serviceRequests.createdAt))
      .limit(100);
    return rows;
  }

  async claim(actor: Actor, providerId: string, requestId: string) {
    await this.policy.requireProviderMember(actor.userId, providerId);
    const r = await this.load(requestId);
    if (r.providerId || r.status !== 'requested') throw conflict('This request is no longer open', 'not_open');
    await this.checkProviderEligible(providerId, r.categoryId);
    const [u] = await this.db.update(serviceRequests).set({ providerId, status: 'accepted' }).where(and(eq(serviceRequests.id, requestId), isNull(serviceRequests.providerId))).returning();
    if (!u) throw conflict('Another provider claimed this request', 'not_open');
    await this.db.insert(serviceRequestEvents).values({ requestId, actorId: actor.userId, fromStatus: 'requested', toStatus: 'accepted', note: 'Claimed from open requests' });
    await this.notifications.notify({ userId: r.requesterId, category: 'services', template: 'service_accepted', title: `A provider accepted "${r.title}"`, data: { type: 'service_request', id: requestId } });
    return this.requestDetail(actor, requestId);
  }

  // ------------------------------------------------------------------ reviews
  async review(actor: Actor, requestId: string, rating: number, body?: string) {
    const r = await this.load(requestId);
    if (r.requesterId !== actor.userId || !r.providerId) throw notFound('Service request');
    if (r.status !== 'completed' && r.status !== 'disputed') throw unprocessable('You can review after the service is completed');
    await this.moderation.assertCanPost(actor.userId);
    const ins = await this.db.insert(providerReviews).values({ requestId, providerId: r.providerId, reviewerId: actor.userId, rating, body }).onConflictDoNothing().returning();
    if (!ins.length) throw conflict('You already reviewed this service', 'already_reviewed');
    await this.notifyProvider(r.providerId, `New ${rating}-star review`, requestId);
    return ins[0];
  }

  async respondToReview(actor: Actor, providerId: string, reviewId: string, response: string) {
    await this.policy.requireProviderMember(actor.userId, providerId);
    const [u] = await this.db.update(providerReviews).set({ providerResponse: response }).where(and(eq(providerReviews.id, reviewId), eq(providerReviews.providerId, providerId))).returning();
    if (!u) throw notFound('Review');
    return u;
  }

  canSeeProvider(id: string) {
    return this.db.select({ id: serviceProviders.id }).from(serviceProviders).where(and(eq(serviceProviders.id, id), eq(serviceProviders.status, 'active')));
  }
}

void forbidden;
void sql;
