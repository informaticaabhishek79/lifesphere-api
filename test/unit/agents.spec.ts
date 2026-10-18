import { detectDocType, cleanName } from '../../src/modules/documents/documents.service';
import { GmailMail, OutlookMail, htmlToText, MailAccountRef } from '../../src/modules/agents/mail.providers';

const acc: MailAccountRef = { id: 'a', provider: 'gmail', address: 'me@example.com', tokens: { accessToken: 't', expiresAt: Date.now() + 1e6 } };
const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = handler(url, init);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  (global as unknown as { fetch: unknown }).fetch = fn;
  return calls;
}

describe('document types and names', () => {
  it('detects types from content, not the name', () => {
    expect(detectDocType(Buffer.from('%PDF-1.7 ...'), 'x.txt')).toBe('application/pdf');
    expect(detectDocType(Buffer.from('hello\nworld'), 'notes.md')).toBe('text/markdown');
    expect(detectDocType(Buffer.from('a,b\n1,2'), 'data.csv')).toBe('text/csv');
    expect(detectDocType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]), 'letter.docx')).toContain('wordprocessingml');
    expect(detectDocType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]), 'archive.zip')).toBeNull();
    expect(detectDocType(Buffer.from([0x4d, 0x5a, 0x00, 0x01]), 'run.txt')).toBeNull();
  });
  it('cleans names', () => {
    expect(cleanName('../../etc/passwd')).toBe('.. .. etc passwd');
    expect(cleanName('  ')).toBe('Untitled');
    expect(cleanName('बिजली बिल.txt')).toBe('बिजली बिल.txt');
  });
});

describe('Gmail', () => {
  afterEach(() => jest.restoreAllMocks());
  const gm = new GmailMail(async () => 'token');

  it('reads the plain text part and thread headers', async () => {
    mockFetch(() => ({
      id: 'm1',
      threadId: 't1',
      labelIds: ['INBOX', 'UNREAD'],
      internalDate: '1760000000000',
      payload: {
        headers: [
          { name: 'From', value: 'Ravi <ravi@example.com>' },
          { name: 'Subject', value: 'Visit' },
          { name: 'Message-ID', value: '<abc@mail>' },
        ],
        parts: [
          { mimeType: 'text/html', body: { data: b64url('<p>html</p>') } },
          { mimeType: 'text/plain', body: { data: b64url('Saturday works') } },
        ],
      },
    }));
    const m = await gm.get(acc, 'm1');
    expect(m).toMatchObject({ id: 'm1', threadId: 't1', subject: 'Visit', text: 'Saturday works', messageIdHeader: '<abc@mail>', unread: true });
  });

  it('replies in the same thread and strips header injection', async () => {
    const calls = mockFetch(() => ({ id: 'sent1' }));
    const msg = { id: 'm1', threadId: 't1', from: 'Ravi <ravi@example.com>\r\nBcc: evil@x.com', subject: 'Visit\nBcc: evil@x.com', date: null, snippet: '', unread: false, to: 'me', text: '', messageIdHeader: '<abc@mail>', references: null, replyTo: null };
    const r = await gm.reply(acc, msg, 'Yes, Saturday is fine.');
    expect(r.sentId).toBe('sent1');
    const body = JSON.parse(String(calls[0].init!.body)) as { raw: string; threadId: string };
    expect(body.threadId).toBe('t1');
    const raw = Buffer.from(body.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    expect(raw).toContain('In-Reply-To: <abc@mail>');
    expect(raw).toContain('Subject: Re: Visit Bcc: evil@x.com');
    expect(raw.split('\r\n\r\n')[0]).not.toMatch(/^Bcc:/m);
    const text = Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
    expect(text).toBe('Yes, Saturday is fine.');
  });
});

describe('Outlook', () => {
  it('escapes the reply as HTML and keeps line breaks', async () => {
    const calls = mockFetch(() => ({}));
    const om = new OutlookMail(async () => 'token');
    await om.reply({ ...acc, provider: 'outlook' }, { id: 'o1', threadId: null, from: '', subject: '', date: null, snippet: '', unread: false, to: '', text: '', messageIdHeader: null, references: null, replyTo: null }, 'Hi <b>x</b>\nBye');
    expect(calls[0].url).toContain('/messages/o1/reply');
    expect(JSON.parse(String(calls[0].init!.body)).comment).toBe('Hi &lt;b&gt;x&lt;/b&gt;<br>Bye');
  });
  it('turns HTML mail into text without scripts', () => {
    expect(htmlToText('<style>p{}</style><p>Hello&nbsp;there</p><script>alert(1)</script><div>Bye</div>')).toBe('Hello there\n Bye');
  });
});

describe('AI provider errors become clear messages', () => {
  it('maps the common failures', async () => {
    const { aiError } = await import('../../src/adapters/ai');
    const code = (s: number, b = '') => (aiError(s, b).getResponse() as { code: string }).code;
    expect(code(401, '{"error":{"type":"authentication_error"}}')).toBe('ai_key_invalid');
    expect(code(400, 'Your credit balance is too low to access the Anthropic API')).toBe('ai_no_credits');
    expect(code(404, 'model: claude-x')).toBe('ai_model_unavailable');
    expect(code(429)).toBe('ai_busy');
    expect(code(529)).toBe('ai_busy');
    expect(aiError(401, 'sk-ant-secret').getResponse()).not.toMatchObject({ detail: expect.stringContaining('sk-ant') });
  });
});
