/* Development / first-install seed. Idempotent. Usage: npm run db:seed  (add -- --admin=+919876543210 to create a super admin) */
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { loadEnv } from '../config/env';
import { createPool } from './db';
import * as s from './schema';

const LOCALITIES = [
  { name: 'Najafgarh', city: 'New Delhi', state: 'Delhi', pincodePrefix: '110', lat: '28.61', lng: '76.98' },
  { name: 'Dwarka', city: 'New Delhi', state: 'Delhi', pincodePrefix: '110', lat: '28.59', lng: '77.05' },
  { name: 'Janakpuri', city: 'New Delhi', state: 'Delhi', pincodePrefix: '110', lat: '28.62', lng: '77.08' },
  { name: 'Rohini', city: 'New Delhi', state: 'Delhi', pincodePrefix: '110', lat: '28.74', lng: '77.07' },
  { name: 'Sector 56', city: 'Gurugram', state: 'Haryana', pincodePrefix: '122', lat: '28.42', lng: '77.10' },
  { name: 'Indiranagar', city: 'Bengaluru', state: 'Karnataka', pincodePrefix: '560', lat: '12.97', lng: '77.64' },
  { name: 'Andheri West', city: 'Mumbai', state: 'Maharashtra', pincodePrefix: '400', lat: '19.14', lng: '72.83' },
];

const CATEGORIES = [
  { slug: 'appliance-repair', name: 'Appliance repair', requiresVerification: false, seniorSupport: false, sortOrder: 1 },
  { slug: 'plumbing', name: 'Plumbing', requiresVerification: false, seniorSupport: false, sortOrder: 2 },
  { slug: 'electrical', name: 'Electrical work', requiresVerification: true, seniorSupport: false, sortOrder: 3 },
  { slug: 'grocery-delivery', name: 'Grocery delivery', requiresVerification: false, seniorSupport: false, sortOrder: 4 },
  { slug: 'home-cleaning', name: 'Home cleaning', requiresVerification: true, seniorSupport: false, sortOrder: 5 },
  { slug: 'errands', name: 'Errands and bill payments (in person)', requiresVerification: true, seniorSupport: false, sortOrder: 6 },
  { slug: 'senior-companionship', name: 'Companionship visits for seniors', requiresVerification: true, seniorSupport: true, sortOrder: 7 },
  { slug: 'home-nursing-attendant', name: 'Home attendant (non-medical)', requiresVerification: true, seniorSupport: true, sortOrder: 8 },
  { slug: 'tech-help', name: 'Phone and computer help', requiresVerification: false, seniorSupport: false, sortOrder: 9 },
];

// Directory entries must be re-verified by the content team before launch (lastReviewedOn left empty on purpose).
const CHANNELS: (typeof s.officialChannels.$inferInsert)[] = [
  { kind: 'consumer', name: 'National Consumer Helpline (INGRAM portal)', url: 'https://consumerhelpline.gov.in', phone: '1915', topics: ['ecommerce', 'telecom', 'banking', 'appliance', 'general'], description: 'Central government grievance redressal for consumers. Register a grievance online or by phone.' },
  { kind: 'consumer', name: 'e-Daakhil (online consumer commission filing)', url: 'https://edaakhil.nic.in', topics: ['general'], description: 'Online filing of complaints with Consumer Commissions.' },
  { kind: 'government', name: 'CPGRAMS (central public grievances)', url: 'https://pgportal.gov.in', topics: ['general'], description: 'Grievances about central government departments and services.' },
  { kind: 'helpline', name: 'Emergency Response Support System', phone: '112', topics: ['emergency'], description: 'All-India emergency number for police, fire and ambulance.' },
  { kind: 'civic', name: 'Municipal Corporation of Delhi — complaints', url: 'https://mcdonline.nic.in', jurisdiction: 'Delhi', topics: ['garbage', 'streetlight', 'road', 'drainage'], description: 'Municipal services complaints for Delhi.' },
];

const ARTICLES = [
  {
    slug: 'how-to-raise-a-consumer-complaint-in-india',
    title: 'How to raise a consumer complaint in India',
    topic: 'consumer_complaints',
    summary: 'Steps to resolve a problem with a product or service: contact the seller, keep records, then escalate to official channels.',
    body: `## Start with the seller\n\nContact the seller or service provider first through their official customer care. Ask for a complaint or ticket number and write it down with the date.\n\n## Keep a record\n\nKeep your invoice or order number, dates of each contact, names of people you spoke to, and screenshots or photos of the problem. LifeSphere's case tracker can hold these notes for you.\n\n## Escalate if unresolved\n\nIf the seller does not resolve the issue in a reasonable time, you can register a grievance with the National Consumer Helpline (phone 1915 or the INGRAM portal at consumerhelpline.gov.in). For disputes that need a formal decision, complaints can be filed with a Consumer Commission, including online through e-Daakhil.\n\n## Important\n\nThis is general information, not legal advice. Check the official portal for current procedures and any fees.`,
  },
  {
    slug: 'setting-up-wellbeing-check-ins',
    title: 'Setting up wellbeing check-ins for a family member',
    topic: 'familycare',
    summary: 'How LifeSphere check-ins work, who gets alerted, and what a missed check-in does and does not mean.',
    body: `## How check-ins work\n\nThe person chooses times to check in, for example 9:00 every morning. At that time LifeSphere asks them to tap "I'm OK".\n\n## If a check-in is missed\n\nLifeSphere first sends them a reminder. If there is still no answer after the grace period they chose, the contacts they selected are alerted. A missed check-in does not mean there is an emergency; contacts should try to reach the person.\n\n## Consent and control\n\nOnly contacts the person has explicitly allowed to "get alerts when you miss a check-in" are told. They can stop sharing at any time.\n\n## Not an emergency service\n\nLifeSphere does not monitor around the clock or dispatch help. In an emergency call 112.`,
  },
  {
    slug: 'spotting-phone-and-online-fraud',
    title: 'Spotting phone and online fraud',
    topic: 'digital_safety',
    summary: 'Common warning signs of scams targeting older adults and families, and what to do.',
    body: `## Warning signs\n\nBe careful when someone creates urgency, asks for an OTP, PIN or password, asks you to install a screen-sharing app, or claims to be from a bank, courier or government office and threatens action.\n\n## What to do\n\nNever share OTPs or passwords. Hang up and call the organisation on a number you find yourself. Talk to a family member or trusted contact before paying anyone.\n\n## Reporting\n\nCyber fraud in India can be reported on the national cybercrime helpline 1930 or at cybercrime.gov.in. Report quickly, especially if money was transferred.`,
  },
];

export async function runSeed(argv: string[] = process.argv) {
  const env = loadEnv();
  const pool = createPool(env.DATABASE_DIRECT_URL ?? env.DATABASE_URL, env, 2);
  const db = drizzle(pool, { schema: s });
  try {
    for (const l of LOCALITIES) await db.insert(s.localities).values(l).onConflictDoNothing();
    for (const c of CATEGORIES) await db.insert(s.serviceCategories).values(c).onConflictDoNothing();
    const existingChannels = await db.select({ name: s.officialChannels.name }).from(s.officialChannels);
    for (const c of CHANNELS) if (!existingChannels.some((e) => e.name === c.name)) await db.insert(s.officialChannels).values(c);

    let [src] = await db.select().from(s.knowledgeSources).where(eq(s.knowledgeSources.name, 'LifeSphere guidance team'));
    if (!src) [src] = await db.insert(s.knowledgeSources).values({ name: 'LifeSphere guidance team', publisher: 'LifeSphere', kind: 'internal', reliabilityTier: 3, reliabilityNote: 'Internal summaries that link to official sources' }).returning();
    for (const a of ARTICLES) {
      const [exists] = await db.select({ id: s.knowledgeArticles.id }).from(s.knowledgeArticles).where(eq(s.knowledgeArticles.slug, a.slug));
      if (exists) continue;
      const [art] = await db.insert(s.knowledgeArticles).values({ ...a, sourceId: src.id, status: 'published', lastReviewedOn: new Date().toISOString().slice(0, 10) }).returning();
      // Inline chunking so search works without the worker.
      const parts = a.body.split(/\n\s*\n/).filter((p) => p.trim() && !p.startsWith('## '));
      const headings = a.body.split(/\n\s*\n/);
      let heading: string | null = null;
      let ord = 0;
      for (const p of headings) {
        if (p.startsWith('## ')) {
          heading = p.slice(3);
          continue;
        }
        if (!p.trim()) continue;
        await db.insert(s.knowledgeChunks).values({ articleId: art.id, ordinal: ord++, heading, content: p.trim(), tokenCount: Math.ceil(p.length / 4) });
      }
      void parts;
    }

    await db.insert(s.plans).values([
      { code: 'free', name: 'Free', subject: 'user', features: { tasks: true, familyCare: true, households: 1, community: true } },
      { code: 'family_plus', name: 'Family Plus', subject: 'household', features: { households: 5, sharedCalendars: true, prioritySupport: true } },
      { code: 'provider_basic', name: 'Provider listing', subject: 'provider', features: { listing: true } },
    ]).onConflictDoNothing();

    await db
      .insert(s.appConfig)
      .values({
        key: 'privacy_notice',
        value: {
          policyVersion: '2026-10',
          noticeUrl: null,
          grievanceOfficer: { name: null, email: null },
          note: 'Fill in the grievance officer and notice URL before launch.',
        },
        description: 'Current privacy notice version and grievance contact',
      })
      .onConflictDoNothing();

    const adminArg = argv.find((a) => a.startsWith('--admin='));
    if (adminArg) {
      const phone = adminArg.split('=')[1];
      let [u] = await db.select().from(s.users).where(eq(s.users.phoneE164, phone));
      if (!u) {
        [u] = await db.insert(s.users).values({ phoneE164: phone, phoneVerifiedAt: new Date(), ageConfirmedAt: new Date() }).returning();
        await db.insert(s.userProfiles).values({ userId: u.id, displayName: 'Platform admin' });
        await db.insert(s.userPreferences).values({ userId: u.id });
        await db.insert(s.consentRecords).values([{ userId: u.id, purpose: 'terms', policyVersion: '2026-10' }, { userId: u.id, purpose: 'privacy_notice', policyVersion: '2026-10' }]);
      }
      await db.insert(s.staffRoles).values({ userId: u.id, role: 'super_admin' }).onConflictDoNothing();
      console.log(`Super admin ready for ${phone}. Sign in with OTP, then enable two-factor (required for /admin).`);
    }
    if (require.main === module) console.log('Seed complete');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runSeed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
