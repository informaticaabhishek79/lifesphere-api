import { SmsAdapter } from '../../src/adapters/messaging';
import { Env } from '../../src/config/env';

const env = {
  SMS_PROVIDER: 'whatsapp',
  WHATSAPP_TOKEN: 'tok',
  WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  WHATSAPP_API_VERSION: 'v23.0',
  WHATSAPP_OTP_TEMPLATE: 'lifesphere_code',
  WHATSAPP_ALERT_TEMPLATE: 'lifesphere_alert',
  WHATSAPP_TEMPLATE_LANGUAGE: 'en',
} as unknown as Env;

function mockFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

describe('WhatsApp instead of SMS', () => {
  const sms = new SmsAdapter(env);

  it('sends a sign-in code with the authentication template and copy-code button', async () => {
    const calls = mockFetch(200, { messages: [{ id: 'wamid.1' }] });
    const r = await sms.send('+919876543210', 'otp', { otp: '508510' });
    expect(r).toMatchObject({ status: 'sent', provider: 'whatsapp', providerMessageId: 'wamid.1' });
    expect(calls[0].url).toBe('https://graph.facebook.com/v23.0/1234567890/messages');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '919876543210', type: 'template', template: { name: 'lifesphere_code', language: { code: 'en' } } });
    expect(body.template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: '508510' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '508510' }] },
    ]);
  });

  it('sends alerts with the utility template, without the SMS prefix or line breaks', async () => {
    const calls = mockFetch(200, { messages: [{ id: 'wamid.2' }] });
    await sms.send('+919876543210', 'alert', { var1: 'LifeSphere: Kamla missed a check-in.\nPlease try to reach them.' });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.template.name).toBe('lifesphere_alert');
    expect(body.template.components).toEqual([{ type: 'body', parameters: [{ type: 'text', text: 'Kamla missed a check-in. Please try to reach them.' }] }]);
  });

  it('reports Meta errors clearly; bad requests are not retried', async () => {
    mockFetch(400, { error: { message: '(#132001) Template name does not exist in the translation', code: 132001 } });
    const r = await sms.send('+919876543210', 'otp', { otp: '111111' });
    expect(r).toMatchObject({ status: 'failed', provider: 'whatsapp', permanent: true });
    expect((r as { error: string }).error).toContain('Template name does not exist');
    mockFetch(429, { error: { message: 'rate limit' } });
    expect(await sms.send('+919876543210', 'otp', { otp: '111111' })).toMatchObject({ status: 'failed', permanent: false });
  });
});
