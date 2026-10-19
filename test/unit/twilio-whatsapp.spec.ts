import { SmsAdapter } from '../../src/adapters/messaging';
import { Env } from '../../src/config/env';

const base = {
  SMS_PROVIDER: 'twilio_whatsapp',
  TWILIO_ACCOUNT_SID: 'AC123',
  TWILIO_AUTH_TOKEN: 'secret',
  TWILIO_WHATSAPP_FROM: '+14155238886',
  TWILIO_WHATSAPP_OTP_CONTENT_SID: 'HXotp',
  TWILIO_WHATSAPP_ALERT_CONTENT_SID: 'HXalert',
  API_BASE_URL: 'https://lifesphere-api.onrender.com',
  WEBHOOK_SECRET: 'webhook-secret-123456',
};

function mockFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}
const form = (init: RequestInit) => new URLSearchParams(String(init.body));

describe('WhatsApp through Twilio', () => {
  it('sends a sign-in code with the approved template and asks for delivery reports', async () => {
    const calls = mockFetch(201, { sid: 'SM1', status: 'queued' });
    const r = await new SmsAdapter(base as unknown as Env).send('+919876543210', 'otp', { otp: '508510' });
    expect(r).toEqual({ status: 'sent', provider: 'twilio_whatsapp', providerMessageId: 'SM1' });
    expect(calls[0].url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('AC123:secret').toString('base64')}`);
    const f = form(calls[0].init);
    expect(f.get('To')).toBe('whatsapp:+919876543210');
    expect(f.get('From')).toBe('whatsapp:+14155238886');
    expect(f.get('ContentSid')).toBe('HXotp');
    expect(JSON.parse(f.get('ContentVariables')!)).toEqual({ '1': '508510' });
    expect(f.get('Body')).toBeNull();
    expect(f.get('StatusCallback')).toBe('https://lifesphere-api.onrender.com/v1/notifications/webhooks/twilio/status?token=webhook-secret-123456');
  });

  it('sends alerts with the alert template, without the SMS prefix or line breaks', async () => {
    const calls = mockFetch(201, { sid: 'SM2' });
    await new SmsAdapter(base as unknown as Env).send('+919876543210', 'alert', { var1: 'LifeSphere: Kamla missed a check-in.\nPlease try to reach them.' });
    const f = form(calls[0].init);
    expect(f.get('ContentSid')).toBe('HXalert');
    expect(JSON.parse(f.get('ContentVariables')!)).toEqual({ '1': 'Kamla missed a check-in. Please try to reach them.' });
  });

  it('without template SIDs sends plain text (sandbox), and accepts a sender already prefixed', async () => {
    const env = { ...base, TWILIO_WHATSAPP_FROM: 'whatsapp:+14155238886', TWILIO_WHATSAPP_OTP_CONTENT_SID: undefined, API_BASE_URL: 'http://localhost:4000' };
    const calls = mockFetch(201, { sid: 'SM3' });
    await new SmsAdapter(env as unknown as Env).send('+919876543210', 'otp', { otp: '111222' });
    const f = form(calls[0].init);
    expect(f.get('From')).toBe('whatsapp:+14155238886');
    expect(f.get('ContentSid')).toBeNull();
    expect(f.get('Body')).toContain('111222 is your LifeSphere code');
    expect(f.get('StatusCallback')).toBeNull();
  });

  it('reports Twilio errors clearly; bad requests are not retried, rate limits are', async () => {
    mockFetch(400, { code: 63007, message: 'Twilio could not find a Channel with the specified From address' });
    const r = await new SmsAdapter(base as unknown as Env).send('+919876543210', 'otp', { otp: '1' });
    expect(r).toMatchObject({ status: 'failed', provider: 'twilio_whatsapp', permanent: true });
    expect((r as { error: string }).error).toContain('63007');
    mockFetch(429, { code: 20429, message: 'Too many requests' });
    expect(await new SmsAdapter(base as unknown as Env).send('+919876543210', 'otp', { otp: '1' })).toMatchObject({ status: 'failed', permanent: false });
  });

  it('refuses to send when not configured', async () => {
    const r = await new SmsAdapter({ SMS_PROVIDER: 'twilio_whatsapp' } as unknown as Env).send('+919876543210', 'otp', { otp: '1' });
    expect(r).toMatchObject({ status: 'failed', permanent: true });
  });
});
