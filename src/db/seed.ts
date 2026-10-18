/* Development / first-install seed. Idempotent. Usage: npm run db:seed  (add -- --admin=+919876543210 or -- --admin=you@example.com to make a super admin) */
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { loadEnv } from '../config/env';
import { createPool } from './db';
import { normalizeEmail } from '../common/crypto.service';
import * as s from './schema';

const LOCALITIES: (typeof s.localities.$inferInsert)[] = [
  // India
  { name: 'Najafgarh', city: 'New Delhi', state: 'Delhi', country: 'IN', pincodePrefix: '110', lat: '28.61', lng: '76.98' },
  { name: 'Dwarka', city: 'New Delhi', state: 'Delhi', country: 'IN', pincodePrefix: '110', lat: '28.59', lng: '77.05' },
  { name: 'Janakpuri', city: 'New Delhi', state: 'Delhi', country: 'IN', pincodePrefix: '110', lat: '28.62', lng: '77.08' },
  { name: 'Rohini', city: 'New Delhi', state: 'Delhi', country: 'IN', pincodePrefix: '110', lat: '28.74', lng: '77.07' },
  { name: 'Sector 56', city: 'Gurugram', state: 'Haryana', country: 'IN', pincodePrefix: '122', lat: '28.42', lng: '77.10' },
  { name: 'Indiranagar', city: 'Bengaluru', state: 'Karnataka', country: 'IN', pincodePrefix: '560', lat: '12.97', lng: '77.64' },
  { name: 'Andheri West', city: 'Mumbai', state: 'Maharashtra', country: 'IN', pincodePrefix: '400', lat: '19.14', lng: '72.83' },
  { name: 'Kothrud', city: 'Pune', state: 'Maharashtra', country: 'IN', pincodePrefix: '411', lat: '18.51', lng: '73.81' },
  { name: 'T. Nagar', city: 'Chennai', state: 'Tamil Nadu', country: 'IN', pincodePrefix: '600', lat: '13.04', lng: '80.23' },
  { name: 'Salt Lake', city: 'Kolkata', state: 'West Bengal', country: 'IN', pincodePrefix: '700', lat: '22.58', lng: '88.41' },
  { name: 'Banjara Hills', city: 'Hyderabad', state: 'Telangana', country: 'IN', pincodePrefix: '500', lat: '17.41', lng: '78.44' },
  // Around the world (examples – staff add more in Admin → Catalogue)
  { name: 'Camden', city: 'London', state: 'England', country: 'GB', pincodePrefix: 'NW1', lat: '51.54', lng: '-0.14' },
  { name: 'Wembley', city: 'London', state: 'England', country: 'GB', pincodePrefix: 'HA9', lat: '51.55', lng: '-0.30' },
  { name: 'Jersey City', city: 'Jersey City', state: 'New Jersey', country: 'US', pincodePrefix: '073', lat: '40.72', lng: '-74.05' },
  { name: 'Queens', city: 'New York', state: 'New York', country: 'US', pincodePrefix: '113', lat: '40.73', lng: '-73.79' },
  { name: 'Sunnyvale', city: 'Sunnyvale', state: 'California', country: 'US', pincodePrefix: '940', lat: '37.37', lng: '-122.04' },
  { name: 'Brampton', city: 'Brampton', state: 'Ontario', country: 'CA', pincodePrefix: 'L6P', lat: '43.73', lng: '-79.76' },
  { name: 'Parramatta', city: 'Sydney', state: 'New South Wales', country: 'AU', pincodePrefix: '2150', lat: '-33.82', lng: '151.00' },
  { name: 'Dubai Marina', city: 'Dubai', state: 'Dubai', country: 'AE', lat: '25.08', lng: '55.14' },
  { name: 'Al Olaya', city: 'Riyadh', state: 'Riyadh', country: 'SA', pincodePrefix: '122', lat: '24.69', lng: '46.68' },
  { name: 'Tampines', city: 'Singapore', state: 'Singapore', country: 'SG', pincodePrefix: '52', lat: '1.35', lng: '103.94' },
  { name: 'Kreuzberg', city: 'Berlin', state: 'Berlin', country: 'DE', pincodePrefix: '109', lat: '52.50', lng: '13.40' },
  { name: 'Le Marais', city: 'Paris', state: 'Île-de-France', country: 'FR', pincodePrefix: '750', lat: '48.86', lng: '2.36' },
  { name: 'Chamberí', city: 'Madrid', state: 'Comunidad de Madrid', country: 'ES', pincodePrefix: '280', lat: '40.43', lng: '-3.70' },
  { name: 'Gulshan', city: 'Dhaka', state: 'Dhaka', country: 'BD', pincodePrefix: '121', lat: '23.79', lng: '90.41' },
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
  { kind: 'consumer', country: 'IN', name: 'National Consumer Helpline (INGRAM portal)', url: 'https://consumerhelpline.gov.in', phone: '1915', topics: ['ecommerce', 'telecom', 'banking', 'appliance', 'general'], description: 'Central government grievance redressal for consumers. Register a grievance online or by phone.' },
  { kind: 'consumer', country: 'IN', name: 'e-Daakhil (online consumer commission filing)', url: 'https://edaakhil.nic.in', topics: ['general'], description: 'Online filing of complaints with Consumer Commissions.' },
  { kind: 'government', country: 'IN', name: 'CPGRAMS (central public grievances)', url: 'https://pgportal.gov.in', topics: ['general'], description: 'Grievances about central government departments and services.' },
  { kind: 'helpline', country: 'IN', name: 'Emergency Response Support System', phone: '112', topics: ['emergency'], description: 'All-India emergency number for police, fire and ambulance.' },
  { kind: 'civic', country: 'IN', name: 'Municipal Corporation of Delhi — complaints', url: 'https://mcdonline.nic.in', jurisdiction: 'Delhi', topics: ['garbage', 'streetlight', 'road', 'drainage'], description: 'Municipal services complaints for Delhi.' },
  // Other countries (examples – verify before launch)
  { kind: 'consumer', country: 'GB', jurisdiction: 'United Kingdom', name: 'Citizens Advice consumer helpline', url: 'https://www.citizensadvice.org.uk/consumer/', phone: '0808 223 1133', topics: ['ecommerce', 'telecom', 'appliance', 'general'], description: 'Free advice on consumer problems in England and Wales; can pass complaints to Trading Standards.' },
  { kind: 'civic', country: 'GB', jurisdiction: 'United Kingdom', name: 'Report a problem to your council (GOV.UK)', url: 'https://www.gov.uk/report-problem-council', topics: ['garbage', 'streetlight', 'road', 'drainage'], description: 'Find your local council and report potholes, missed bins, broken streetlights and more.' },
  { kind: 'consumer', country: 'US', jurisdiction: 'United States', name: 'FTC ReportFraud', url: 'https://reportfraud.ftc.gov', topics: ['ecommerce', 'banking', 'general'], description: 'Report scams, fraud and bad business practices to the Federal Trade Commission.' },
  { kind: 'consumer', country: 'US', jurisdiction: 'United States', name: 'CFPB complaint (banking & credit)', url: 'https://www.consumerfinance.gov/complaint/', topics: ['banking'], description: 'Complaints about banks, credit cards, loans and money transfers.' },
  { kind: 'consumer', country: 'CA', jurisdiction: 'Canada', name: 'Canadian Anti-Fraud Centre', url: 'https://antifraudcentre-centreantifraude.ca', phone: '1-888-495-8501', topics: ['ecommerce', 'banking', 'general'], description: 'Report fraud and scams in Canada.' },
  { kind: 'consumer', country: 'AU', jurisdiction: 'Australia', name: 'ACCC consumer complaints', url: 'https://www.accc.gov.au/consumers/complaints-and-problems', topics: ['ecommerce', 'appliance', 'general'], description: 'Information and complaints about consumer rights in Australia.' },
  { kind: 'consumer', country: 'FR', jurisdiction: 'France', name: 'SignalConso', url: 'https://signal.conso.gouv.fr', topics: ['ecommerce', 'telecom', 'general'], description: 'Signalez un problème avec une entreprise (DGCCRF).' },
  { kind: 'consumer', country: 'DE', jurisdiction: 'Deutschland', name: 'Verbraucherzentrale', url: 'https://www.verbraucherzentrale.de', topics: ['ecommerce', 'telecom', 'general'], description: 'Verbraucherberatung und Beschwerden in Deutschland.' },
  { kind: 'consumer', country: 'ES', jurisdiction: 'España', name: 'Hojas de reclamaciones (consumo)', url: 'https://www.consumo.gob.es', topics: ['general'], description: 'Información sobre reclamaciones de consumo en España.' },
  { kind: 'consumer', jurisdiction: 'European Union', name: 'European Consumer Centres Network (ECC-Net)', url: 'https://commission.europa.eu/live-work-travel-eu/consumer-rights-and-complaints/resolve-your-consumer-complaint/european-consumer-centres-network-ecc-net_en', topics: ['ecommerce', 'general'], description: 'Free help with complaints against a trader in another EU country, Iceland or Norway.' },
];

const ARTICLES: { slug: string; country: string | null; title: string; topic: string; summary: string; body: string }[] = [
  {
    slug: 'how-to-raise-a-consumer-complaint-in-india',
    country: 'IN',
    title: 'How to raise a consumer complaint in India',
    topic: 'consumer_complaints',
    summary: 'Steps to resolve a problem with a product or service: contact the seller, keep records, then escalate to official channels.',
    body: `## Start with the seller\n\nContact the seller or service provider first through their official customer care. Ask for a complaint or ticket number and write it down with the date.\n\n## Keep a record\n\nKeep your invoice or order number, dates of each contact, names of people you spoke to, and screenshots or photos of the problem. LifeSphere's case tracker can hold these notes for you.\n\n## Escalate if unresolved\n\nIf the seller does not resolve the issue in a reasonable time, you can register a grievance with the National Consumer Helpline (phone 1915 or the INGRAM portal at consumerhelpline.gov.in). For disputes that need a formal decision, complaints can be filed with a Consumer Commission, including online through e-Daakhil.\n\n## Important\n\nThis is general information, not legal advice. Check the official portal for current procedures and any fees.`,
  },
  {
    slug: 'setting-up-wellbeing-check-ins',
    country: null,
    title: 'Setting up wellbeing check-ins for a family member',
    topic: 'familycare',
    summary: 'How LifeSphere check-ins work, who gets alerted, and what a missed check-in does and does not mean.',
    body: `## How check-ins work\n\nThe person chooses times to check in, for example 9:00 every morning. At that time LifeSphere asks them to tap "I'm OK".\n\n## If a check-in is missed\n\nLifeSphere first sends them a reminder. If there is still no answer after the grace period they chose, the contacts they selected are alerted. A missed check-in does not mean there is an emergency; contacts should try to reach the person.\n\n## Consent and control\n\nOnly contacts the person has explicitly allowed to "get alerts when you miss a check-in" are told. They can stop sharing at any time.\n\n## Not an emergency service\n\nLifeSphere does not monitor around the clock or dispatch help. In an emergency call 112.`,
  },
  {
    slug: 'spotting-phone-and-online-fraud',
    country: 'IN',
    title: 'Spotting phone and online fraud',
    topic: 'digital_safety',
    summary: 'Common warning signs of scams targeting older adults and families, and what to do.',
    body: `## Warning signs\n\nBe careful when someone creates urgency, asks for an OTP, PIN or password, asks you to install a screen-sharing app, or claims to be from a bank, courier or government office and threatens action.\n\n## What to do\n\nNever share OTPs or passwords. Hang up and call the organisation on a number you find yourself. Talk to a family member or trusted contact before paying anyone.\n\n## Reporting\n\nCyber fraud in India can be reported on the national cybercrime helpline 1930 or at cybercrime.gov.in. Report quickly, especially if money was transferred.`,
  },
  {
    slug: 'how-to-raise-a-consumer-complaint',
    country: null,
    title: 'How to raise a consumer complaint (anywhere)',
    topic: 'consumer_complaints',
    summary: 'A step-by-step approach that works in most countries: seller first, keep records, then your national consumer body.',
    body: `## Start with the seller\n\nContact the seller or service provider through their official customer care first. Ask for a ticket or reference number and note the date.\n\n## Keep a record\n\nKeep the receipt or order number, dates of each contact, names of people you spoke to, and photos or screenshots. LifeSphere's case tracker keeps these together.\n\n## Escalate if it is not resolved\n\nMost countries have a free national consumer body or ombudsman, and many have an online dispute portal. LifeSphere lists the official channels for your country in Consumer help. If you paid by card, ask your bank about a chargeback.\n\n## Important\n\nThis is general information, not legal advice. Rules and time limits differ by country.`,
  },
  {
    slug: 'spotting-scams-anywhere',
    country: null,
    title: 'Spotting scams: warning signs that apply everywhere',
    topic: 'digital_safety',
    summary: 'Urgency, secrecy and requests for codes or payment are the classic signs of a scam in any country.',
    body: `## Warning signs\n\nSomeone creates urgency, asks you to keep it secret, asks for a one-time code, PIN or password, asks you to install a remote-access app, or wants payment by gift card, crypto or wire transfer.\n\n## What to do\n\nStop and hang up. Call the organisation back on a number you find yourself. Talk to a family member or trusted contact before paying anyone.\n\n## Report it\n\nReport scams to your national fraud or consumer agency and to your bank straight away if money was sent.`,
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
    for (const c of CHANNELS) {
      if (!existingChannels.some((e) => e.name === c.name)) await db.insert(s.officialChannels).values(c);
      else if (c.country) await db.update(s.officialChannels).set({ country: c.country }).where(eq(s.officialChannels.name, c.name));
    }

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

    // --admin=+919876543210 or --admin=you@example.com. An existing account (for example one made with Google) just gets the role.
    const adminArg = argv.find((a) => a.startsWith('--admin='));
    if (adminArg) {
      const raw = adminArg.slice('--admin='.length).trim();
      const isEmail = raw.includes('@');
      const email = isEmail ? normalizeEmail(raw) : null;
      if (isEmail && !email) throw new Error(`Not a valid email: ${raw}`);
      if (!isEmail && !/^\+[1-9]\d{6,14}$/.test(raw)) throw new Error(`Use a phone number with country code (+91…) or an email: ${raw}`);
      let [u] = await db.select().from(s.users).where(isEmail ? eq(s.users.email, email!) : eq(s.users.phoneE164, raw));
      if (!u) {
        const now = new Date();
        [u] = await db
          .insert(s.users)
          .values(isEmail ? { email: email!, emailVerifiedAt: now, ageConfirmedAt: now } : { phoneE164: raw, phoneVerifiedAt: now, ageConfirmedAt: now })
          .returning();
        await db.insert(s.userProfiles).values({ userId: u.id, displayName: 'Platform admin' });
        await db.insert(s.userPreferences).values({ userId: u.id });
        await db.insert(s.consentRecords).values([{ userId: u.id, purpose: 'terms', policyVersion: '2026-10' }, { userId: u.id, purpose: 'privacy_notice', policyVersion: '2026-10' }]);
      }
      await db.insert(s.staffRoles).values({ userId: u.id, role: 'super_admin' }).onConflictDoNothing();
      console.log(`Super admin ready for ${raw}. Sign in, then turn on two-step verification in Settings (required for /admin).`);
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
