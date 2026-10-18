import type { AiTool } from '../../adapters/ai';
import type { Actor } from '../../common/auth-context';

/** Something the assistant can open, so the person can check the answer themselves. */
export interface SourceLink {
  label: string;
  href: string;
}

export interface ToolResult {
  /** Compact JSON for the model. */
  data: unknown;
  /** Plain-English sentence used when no AI is configured. */
  say: string;
  links: SourceLink[];
}

export interface ToolContext {
  actor: Actor;
  timeZone: string;
  country: string | null;
  currency: string;
  /** Document folders the assistant may read (already expanded to include folders inside). */
  folderIds: string[];
}

export type Feature = 'lifeos' | 'household' | 'familycare' | 'community' | 'consumer' | 'services' | 'assistant' | 'documents' | 'agents';

export interface VoiceTool extends AiTool {
  /** The app area this tool reads; it is unavailable when that area is switched off. */
  feature: Feature | null;
}

const str = (desc: string, enumValues?: string[]) => ({ type: 'string', description: desc, ...(enumValues ? { enum: enumValues } : {}) });

export const VOICE_TOOLS: VoiceTool[] = [
  {
    name: 'tasks',
    feature: 'lifeos',
    description: 'The person’s tasks and chores (their own, household and ones assigned to them). Use for “what do I have to do”, due dates, overdue items.',
    input_schema: { type: 'object', properties: { when: str('Which tasks', ['today', 'tomorrow', 'overdue', 'this_week', 'open', 'done_recently']), search: str('Words in the task title') } },
  },
  {
    name: 'reminders',
    feature: 'lifeos',
    description: 'Upcoming reminders the person has set.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'calendar',
    feature: 'lifeos',
    description: 'Calendar events, appointments and visits.',
    input_schema: { type: 'object', properties: { when: str('Time range', ['today', 'tomorrow', 'this_week', 'next_7_days', 'this_month', 'next_30_days']), search: str('Words in the event title') } },
  },
  {
    name: 'households',
    feature: 'household',
    description: 'The households the person belongs to, their members and pinned announcements.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'shopping_lists',
    feature: 'household',
    description: 'Shopping and grocery lists and the items still to buy.',
    input_schema: { type: 'object', properties: { list_name: str('Part of the list name, if they named one') } },
  },
  {
    name: 'home_inventory',
    feature: 'household',
    description: 'Appliances and things at home: warranty dates, next maintenance, service history.',
    input_schema: { type: 'object', properties: { search: str('Item name, e.g. AC, purifier') } },
  },
  {
    name: 'budget',
    feature: 'household',
    description: 'The monthly budget the person fills in themselves: planned, spent and left per category.',
    input_schema: { type: 'object', properties: { month: str('Month as YYYY-MM; default this month') } },
  },
  {
    name: 'check_ins',
    feature: 'familycare',
    description: 'Daily “I’m OK” check-ins and medicine reminders (taken or not) for today, and how the people who share with them are doing (check-ins, medicines, help requests).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'contacts_and_sharing',
    feature: 'familycare',
    description: 'Trusted contacts and exactly what is shared with whom.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'emergency_help',
    feature: 'familycare',
    description: 'The emergency number and who is alerted when the person presses Get help. Use for any urgent safety question.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'consumer',
    feature: 'consumer',
    description: 'Consumer complaints being tracked, purchases and warranties.',
    input_schema: { type: 'object', properties: { what: str('Which part', ['complaints', 'purchases', 'warranties_expiring']) } },
  },
  {
    name: 'service_requests',
    feature: 'services',
    description: 'Local service bookings and requests the person made (plumber, electrician, care…) and their status.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'community',
    feature: 'community',
    description: 'Recent posts in the person’s community groups.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'civic_issues',
    feature: 'community',
    description: 'Neighbourhood issues the person recorded (streetlights, garbage…) and complaint numbers.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_documents',
    feature: 'documents',
    description: 'Search the person’s documents by file name or text, only in the folders they allowed the assistant to read.',
    input_schema: { type: 'object', properties: { query: str('Words to look for') }, required: ['query'] },
  },
  {
    name: 'read_document',
    feature: 'documents',
    description: 'Read the text of one document found with search_documents.',
    input_schema: { type: 'object', properties: { file_id: str('File id from search_documents') }, required: ['file_id'] },
  },
  {
    name: 'guides',
    feature: null,
    description: 'Public, reviewed guidance (consumer rights, scams and digital safety, civic services, family care, home). Use for general “how do I / what are my rights” questions.',
    input_schema: { type: 'object', properties: { query: str('The question') }, required: ['query'] },
  },
  {
    name: 'app_guide',
    feature: null,
    description: 'How to do things in LifeSphere and where each feature is.',
    input_schema: { type: 'object', properties: { topic: str('What they want to do') }, required: ['topic'] },
  },
];

/** Where things are in the app, for “how do I…” questions. */
export const APP_GUIDE: { keys: RegExp; feature: Feature | null; label: string; href: string; how: string }[] = [
  { keys: /task|to.?do|chore|काम/i, feature: 'lifeos', label: 'Tasks', href: '/tasks', how: 'Open Tasks and press “New task”. You can set a due date, repeat it, add a reminder, or offer it to a family member.' },
  { keys: /remind|याद/i, feature: 'lifeos', label: 'Reminders', href: '/reminders', how: 'Open Reminders and press “New reminder”, or add a reminder when you create a task.' },
  { keys: /calendar|event|appointment|visit|कैलेंडर/i, feature: 'lifeos', label: 'Calendar', href: '/calendar', how: 'Open Calendar and press “New event”. You can invite family and mark visits.' },
  { keys: /shop|grocer|list|सूची|किराना/i, feature: 'household', label: 'Shopping lists', href: '/lists', how: 'Open Shopping lists, create a list, and share it with your household so everyone can tick items.' },
  { keys: /household|family member|invite/i, feature: 'household', label: 'Households', href: '/households', how: 'Open Households, create one and invite people by phone or email.' },
  { keys: /inventory|appliance|warranty|maintenance|service history/i, feature: 'household', label: 'Home inventory', href: '/inventory', how: 'Open Home inventory, add the item with its warranty date, and add a maintenance schedule to get reminders.' },
  { keys: /budget|spend|बजट/i, feature: 'household', label: 'Budget', href: '/budgets', how: 'Open Budget and add a category with what you plan to spend; update what you spent as you go.' },
  { keys: /check.?in|i.?m ok|ठीक|चेक-इन/i, feature: 'familycare', label: 'Check-ins', href: '/check-ins', how: 'Open Check-ins, press “New check-in”, choose the time and which contacts are alerted if you miss it.' },
  { keys: /share|sharing|grant|permission/i, feature: 'familycare', label: 'Sharing', href: '/sharing', how: 'Open Sharing to choose exactly what each trusted contact can see or do. New sharing starts after a short waiting period.' },
  { keys: /contact|trusted/i, feature: 'familycare', label: 'Trusted contacts', href: '/contacts', how: 'Open Trusted contacts and invite someone by phone or email.' },
  { keys: /help|emergency|sos|मदद/i, feature: 'familycare', label: 'Get help', href: '/help', how: 'Press the red “Get help” button at the top. It alerts the contacts you chose; in an emergency call your local emergency number.' },
  { keys: /complain|refund|consumer|शिकायत/i, feature: 'consumer', label: 'Consumer help', href: '/consumer', how: 'Open Consumer help, track a complaint, keep evidence and draft a letter. You file it yourself on the official site and note the reference number.' },
  { keys: /plumber|electrician|service|provider|repair/i, feature: 'services', label: 'Local services', href: '/services', how: 'Open Local services to find a provider and request a visit, or post an open request.' },
  { keys: /group|community|neighbour|post/i, feature: 'community', label: 'Community', href: '/community', how: 'Open Community to join groups near you and post updates.' },
  { keys: /streetlight|garbage|pothole|civic/i, feature: 'community', label: 'Civic issues', href: '/civic', how: 'Open Civic issues to record a problem, see where to report it, and keep the complaint number.' },
  { keys: /document|file|folder|upload/i, feature: 'documents', label: 'Documents', href: '/documents', how: 'Open Documents, create a folder and upload files or write notes.' },
  { keys: /agent|email|mail|reply/i, feature: 'agents', label: 'My agents', href: '/agents', how: 'Open My agents to create an email agent (replies to an email you choose) or a documents agent (works only in folders you give it).' },
  { keys: /language|text size|senior|theme|dark|settings/i, feature: null, label: 'Settings', href: '/settings', how: 'Open Settings to change language, text size, senior mode, quiet hours and which features are on.' },
  { keys: /privacy|delete my|export|my data/i, feature: null, label: 'Privacy & data', href: '/privacy', how: 'Open Privacy & data to download your data, change consents or delete your account.' },
];
