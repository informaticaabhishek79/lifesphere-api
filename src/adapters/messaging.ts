import { Inject, Injectable, Logger } from '@nestjs/common';
import { GoogleAuth } from 'google-auth-library';
import webpush from 'web-push';
import { Env, ENV } from '../config/env';

export type DeliveryResult =
  | { status: 'sent'; provider: string; providerMessageId?: string }
  | { status: 'simulated'; provider: 'mock'; providerMessageId: string }
  | { status: 'failed'; provider: string; error: string; permanent?: boolean };

/**
 * Template keys. MSG91 (India) sends provider-approved DLT templates with variables only; Twilio (rest of
 * the world) sends the rendered text below. With SMS_PROVIDER=routed, +91 numbers go through MSG91 and all
 * other numbers through Twilio.
 */
export type SmsTemplate = 'otp' | 'alert';

/**
 * In-memory outbox for simulated sends. Used by development tooling and tests.
 * Never used in production (mock providers are labelled as simulated in every status).
 */
export const simulatedOutbox: { channel: string; to: string; template: string; vars: Record<string, string>; at: Date }[] = [];

@Injectable()
export class SmsAdapter {
  private readonly logger = new Logger('SMS');
  constructor(@Inject(ENV) private readonly env: Env) {}

  async send(toE164: string, template: SmsTemplate, vars: Record<string, string>): Promise<DeliveryResult> {
    const provider = this.env.SMS_PROVIDER === 'routed' ? (toE164.startsWith('+91') ? 'msg91' : 'twilio') : this.env.SMS_PROVIDER;
    if (provider === 'twilio') return this.sendTwilio(toE164, template, vars);
    if (provider === 'whatsapp') return this.sendWhatsApp(toE164, template, vars);
    if (provider === 'twilio_whatsapp') return this.sendTwilioWhatsApp(toE164, template, vars);
    if (provider === 'mock') {
      simulatedOutbox.push({ channel: 'sms', to: toE164, template, vars, at: new Date() });
      if (simulatedOutbox.length > 500) simulatedOutbox.shift();
      this.logger.log(`[SIMULATED] sms template=${template} to=${toE164.slice(0, 3)}***${toE164.slice(-2)}`);
      return { status: 'simulated', provider: 'mock', providerMessageId: `sim-${Date.now()}` };
    }
    const templateId = template === 'otp' ? this.env.MSG91_OTP_TEMPLATE_ID : this.env.MSG91_ALERT_TEMPLATE_ID;
    if (!templateId) return { status: 'failed', provider: 'msg91', error: `No MSG91 template configured for ${template}`, permanent: true };
    try {
      const res = await fetch('https://control.msg91.com/api/v5/flow', {
        method: 'POST',
        headers: { authkey: this.env.MSG91_AUTH_KEY!, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          template_id: templateId,
          short_url: '0',
          sender: this.env.MSG91_SENDER_ID,
          recipients: [{ mobiles: toE164.replace('+', ''), ...vars }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
      if (!res.ok || body.type === 'error') {
        return { status: 'failed', provider: 'msg91', error: `HTTP ${res.status}: ${body.message ?? 'error'}`.slice(0, 280), permanent: res.status === 400 };
      }
      return { status: 'sent', provider: 'msg91', providerMessageId: body.message };
    } catch (e) {
      return { status: 'failed', provider: 'msg91', error: (e as Error).message.slice(0, 280) };
    }
  }

  /**
   * WhatsApp Cloud API (Meta). Business-initiated messages must use approved templates:
   * - codes: an Authentication template; the code fills the body and the "Copy code" button.
   * - alerts: a Utility template with one body variable, e.g. "LifeSphere: {{1}}".
   */
  private async sendWhatsApp(toE164: string, template: SmsTemplate, vars: Record<string, string>): Promise<DeliveryResult> {
    const e = this.env;
    if (!e.WHATSAPP_TOKEN || !e.WHATSAPP_PHONE_NUMBER_ID) return { status: 'failed', provider: 'whatsapp', error: 'WhatsApp is not configured', permanent: true };
    // The template already says "LifeSphere", so the SMS-style prefix is dropped. WhatsApp parameters may not
    // contain new lines or long runs of spaces.
    const text = template === 'otp' ? vars.otp : (vars.var1 ?? '').replace(/^LifeSphere:\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 900);
    if (!text) return { status: 'failed', provider: 'whatsapp', error: 'Empty message', permanent: true };
    const components =
      template === 'otp'
        ? [
            { type: 'body', parameters: [{ type: 'text', text }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text }] },
          ]
        : [{ type: 'body', parameters: [{ type: 'text', text }] }];
    try {
      const res = await fetch(`https://graph.facebook.com/${e.WHATSAPP_API_VERSION}/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${e.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toE164.replace(/^\+/, ''),
          type: 'template',
          template: { name: template === 'otp' ? e.WHATSAPP_OTP_TEMPLATE : e.WHATSAPP_ALERT_TEMPLATE, language: { code: e.WHATSAPP_TEMPLATE_LANGUAGE }, components },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const out = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number; error_data?: { details?: string } } };
      if (!res.ok || !out.messages?.[0]?.id) {
        const msg = [out.error?.message, out.error?.error_data?.details].filter(Boolean).join(' — ') || 'error';
        this.logger.warn(`WhatsApp ${template} failed: HTTP ${res.status} ${msg}`);
        // 4xx other than rate limits (130429/131056) won't succeed on retry.
        return { status: 'failed', provider: 'whatsapp', error: `HTTP ${res.status}: ${msg}`.slice(0, 280), permanent: res.status >= 400 && res.status < 500 && res.status !== 429 };
      }
      return { status: 'sent', provider: 'whatsapp', providerMessageId: out.messages[0].id };
    } catch (err) {
      return { status: 'failed', provider: 'whatsapp', error: (err as Error).message.slice(0, 280) };
    }
  }

  /**
   * WhatsApp through Twilio's Messages API. Messages LifeSphere starts (codes, alerts) need approved Content
   * templates outside a 24-hour chat window: TWILIO_WHATSAPP_OTP_CONTENT_SID (an Authentication template, the code
   * is variable 1) and TWILIO_WHATSAPP_ALERT_CONTENT_SID (a Utility template whose body has one variable {{1}}).
   * Without a template SID the text is sent as a plain message, which only works in the sandbox or an open chat.
   */
  private async sendTwilioWhatsApp(toE164: string, template: SmsTemplate, vars: Record<string, string>): Promise<DeliveryResult> {
    const e = this.env;
    const sid = e.TWILIO_ACCOUNT_SID;
    const token = e.TWILIO_AUTH_TOKEN;
    if (!sid || !token || !(e.TWILIO_WHATSAPP_FROM || e.TWILIO_MESSAGING_SERVICE_SID))
      return { status: 'failed', provider: 'twilio_whatsapp', error: 'WhatsApp via Twilio is not configured', permanent: true };
    const wa = (n: string) => (n.startsWith('whatsapp:') ? n : `whatsapp:${n.trim()}`);
    // The alert template already says "LifeSphere"; template variables may not contain new lines.
    const text = template === 'otp' ? vars.otp : (vars.var1 ?? '').replace(/^LifeSphere:\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 900);
    if (!text) return { status: 'failed', provider: 'twilio_whatsapp', error: 'Empty message', permanent: true };
    const contentSid = template === 'otp' ? e.TWILIO_WHATSAPP_OTP_CONTENT_SID : e.TWILIO_WHATSAPP_ALERT_CONTENT_SID;
    const form = new URLSearchParams({ To: wa(toE164) });
    if (e.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', e.TWILIO_MESSAGING_SERVICE_SID);
    if (e.TWILIO_WHATSAPP_FROM) form.set('From', wa(e.TWILIO_WHATSAPP_FROM));
    // Twilio reports "delivered" or "undelivered" (e.g. the number isn't on WhatsApp) later, to our webhook.
    if (e.API_BASE_URL.startsWith('https://') && e.WEBHOOK_SECRET)
      form.set('StatusCallback', `${e.API_BASE_URL.replace(/\/$/, '')}/v1/notifications/webhooks/twilio/status?token=${encodeURIComponent(e.WEBHOOK_SECRET)}`);
    if (contentSid) {
      form.set('ContentSid', contentSid);
      form.set('ContentVariables', JSON.stringify({ '1': text }));
    } else {
      form.set('Body', template === 'otp' ? `${text} is your LifeSphere code. It expires in 10 minutes. Never share it.` : `LifeSphere update: ${text} Open the LifeSphere app for details.`);
    }
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      const out = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number; status?: string };
      if (!res.ok || !out.sid) {
        const msg = `${out.code ? `${out.code} ` : ''}${out.message ?? 'error'}`;
        this.logger.warn(`WhatsApp (Twilio) ${template} failed: HTTP ${res.status} ${msg}`);
        // Bad requests and auth errors won't succeed on retry; rate limits and server errors might.
        return { status: 'failed', provider: 'twilio_whatsapp', error: `HTTP ${res.status}: ${msg}`.slice(0, 280), permanent: res.status >= 400 && res.status < 500 && res.status !== 429 };
      }
      return { status: 'sent', provider: 'twilio_whatsapp', providerMessageId: out.sid };
    } catch (err) {
      return { status: 'failed', provider: 'twilio_whatsapp', error: (err as Error).message.slice(0, 280) };
    }
  }

  private async sendTwilio(toE164: string, template: SmsTemplate, vars: Record<string, string>): Promise<DeliveryResult> {
    const sid = this.env.TWILIO_ACCOUNT_SID;
    const token = this.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return { status: 'failed', provider: 'twilio', error: 'Twilio is not configured', permanent: true };
    const body = template === 'otp' ? `${vars.otp} is your LifeSphere code. It expires in 10 minutes. Never share it.` : (vars.var1 ?? '').slice(0, 300);
    const form = new URLSearchParams({ To: toE164, Body: body });
    if (this.env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', this.env.TWILIO_MESSAGING_SERVICE_SID);
    else form.set('From', this.env.TWILIO_FROM ?? '');
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      const out = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
      if (!res.ok) return { status: 'failed', provider: 'twilio', error: `HTTP ${res.status}: ${out.message ?? 'error'}`.slice(0, 280), permanent: res.status === 400 };
      return { status: 'sent', provider: 'twilio', providerMessageId: out.sid };
    } catch (e) {
      return { status: 'failed', provider: 'twilio', error: (e as Error).message.slice(0, 280) };
    }
  }
}

@Injectable()
export class EmailAdapter {
  private readonly logger = new Logger('Email');
  constructor(@Inject(ENV) private readonly env: Env) {}

  async send(to: string, subject: string, text: string): Promise<DeliveryResult> {
    if (this.env.EMAIL_PROVIDER === 'mock') {
      simulatedOutbox.push({ channel: 'email', to, template: subject, vars: { text }, at: new Date() });
      if (simulatedOutbox.length > 500) simulatedOutbox.shift();
      this.logger.log(`[SIMULATED] email subject="${subject}"`);
      return { status: 'simulated', provider: 'mock', providerMessageId: `sim-${Date.now()}` };
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: this.env.EMAIL_FROM, to: [to], subject, text }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) return { status: 'failed', provider: 'resend', error: `HTTP ${res.status}: ${body.message ?? ''}`.slice(0, 280), permanent: res.status === 422 };
      return { status: 'sent', provider: 'resend', providerMessageId: body.id };
    } catch (e) {
      return { status: 'failed', provider: 'resend', error: (e as Error).message.slice(0, 280) };
    }
  }
}

export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
  critical?: boolean;
}

@Injectable()
export class PushAdapter {
  private readonly logger = new Logger('Push');
  private auth: GoogleAuth | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {
    if (env.PUSH_PROVIDER === 'fcm' && env.FCM_SERVICE_ACCOUNT_JSON) {
      const credentials = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
      this.auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/firebase.messaging'] });
    }
    if (env.WEBPUSH_VAPID_PUBLIC_KEY && env.WEBPUSH_VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(env.WEBPUSH_SUBJECT, env.WEBPUSH_VAPID_PUBLIC_KEY, env.WEBPUSH_VAPID_PRIVATE_KEY);
    }
  }

  async send(platform: 'web' | 'android' | 'ios', token: string, msg: PushMessage): Promise<DeliveryResult> {
    if (platform === 'web') return this.sendWebPush(token, msg);
    if (this.env.PUSH_PROVIDER === 'mock' || !this.auth) {
      simulatedOutbox.push({ channel: 'push', to: platform, template: msg.title, vars: msg.data, at: new Date() });
      if (simulatedOutbox.length > 500) simulatedOutbox.shift();
      this.logger.log(`[SIMULATED] push platform=${platform}`);
      return { status: 'simulated', provider: 'mock', providerMessageId: `sim-${Date.now()}` };
    }
    try {
      const client = await this.auth.getClient();
      const projectId = this.env.FCM_PROJECT_ID ?? (await this.auth.getProjectId());
      const accessToken = (await client.getAccessToken()).token;
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: msg.title, body: msg.body },
            data: msg.data,
            android: { priority: msg.critical ? 'HIGH' : 'NORMAL' },
            apns: { headers: { 'apns-priority': msg.critical ? '10' : '5' } },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => ({}))) as { name?: string; error?: { status?: string; message?: string } };
      if (!res.ok) {
        const permanent = body.error?.status === 'NOT_FOUND' || body.error?.status === 'INVALID_ARGUMENT' || res.status === 404;
        return { status: 'failed', provider: 'fcm', error: `${body.error?.status ?? res.status}`, permanent };
      }
      return { status: 'sent', provider: 'fcm', providerMessageId: body.name };
    } catch (e) {
      return { status: 'failed', provider: 'fcm', error: (e as Error).message.slice(0, 280) };
    }
  }

  private async sendWebPush(subscriptionJson: string, msg: PushMessage): Promise<DeliveryResult> {
    if (!this.env.WEBPUSH_VAPID_PUBLIC_KEY || !this.env.WEBPUSH_VAPID_PRIVATE_KEY) {
      simulatedOutbox.push({ channel: 'webpush', to: 'web', template: msg.title, vars: msg.data, at: new Date() });
      if (simulatedOutbox.length > 500) simulatedOutbox.shift();
      this.logger.log('[SIMULATED] web push (VAPID keys not configured)');
      return { status: 'simulated', provider: 'mock', providerMessageId: `sim-${Date.now()}` };
    }
    try {
      const sub = JSON.parse(subscriptionJson);
      const r = await webpush.sendNotification(sub, JSON.stringify({ title: msg.title, body: msg.body, data: msg.data }), {
        TTL: msg.critical ? 3600 : 86400,
        urgency: msg.critical ? 'high' : 'normal',
        timeout: 10_000,
      });
      return { status: 'sent', provider: 'webpush', providerMessageId: r.headers?.location };
    } catch (e) {
      const statusCode = (e as { statusCode?: number }).statusCode;
      return { status: 'failed', provider: 'webpush', error: `${statusCode ?? ''} ${(e as Error).message}`.slice(0, 280), permanent: statusCode === 404 || statusCode === 410 };
    }
  }

  get vapidPublicKey(): string | null {
    return this.env.WEBPUSH_VAPID_PUBLIC_KEY ?? null;
  }
}
