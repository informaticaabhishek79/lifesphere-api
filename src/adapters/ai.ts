import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/errors';
import { Env, ENV } from '../config/env';

/**
 * Turns an AI provider failure into a clear, safe message (no key or request content), so the person or
 * operator can fix it: wrong key, no credits, unknown model, or the service being busy.
 */
export function aiError(status: number, body: string): AppError {
  let detail = 'The AI service could not answer right now. Please try again.';
  let code = 'ai_unavailable';
  if (status === 401) [code, detail] = ['ai_key_invalid', 'The AI key was rejected. Check ANTHROPIC_API_KEY in the API settings.'];
  else if (status === 403) [code, detail] = ['ai_forbidden', 'The AI key is not allowed to use this model or workspace.'];
  else if (/credit balance/i.test(body)) [code, detail] = ['ai_no_credits', 'The AI account has no credits left. Add credits in the Anthropic console.'];
  else if (status === 404 || /model/i.test(body)) [code, detail] = ['ai_model_unavailable', 'The AI model in AI_MODEL is not available for this key.'];
  else if (status === 429) [code, detail] = ['ai_busy', 'Too many AI requests right now. Try again in a minute.'];
  else if (status === 529 || status >= 500) [code, detail] = ['ai_busy', 'The AI service is busy. Try again in a moment.'];
  return new AppError(503, code, detail);
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiCompletion {
  text: string;
  model: string;
  simulated: boolean;
}

/**
 * Provider abstraction for text generation. Only public knowledge and text the user explicitly
 * submits for assistance are ever sent. No user identifiers are included in requests.
 */
export interface AiTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type AiBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface AiToolMessage {
  role: 'user' | 'assistant';
  content: string | AiBlock[];
}

export interface AiToolTurn {
  content: AiBlock[];
  stopReason: string;
  model: string;
}

@Injectable()
export class AiAdapter {
  private readonly logger = new Logger('AiAdapter');
  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled() {
    return true;
  }

  async complete(system: string, messages: AiMessage[], maxTokens = 800): Promise<AiCompletion> {
    if (this.env.AI_PROVIDER === 'mock') return this.mock(system, messages);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: this.env.AI_MODEL, max_tokens: maxTokens, system, messages }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      this.logger.warn(`AI provider error ${res.status}: ${err.slice(0, 300)}`);
      throw aiError(res.status, err);
    }
    const body = (await res.json()) as { content?: { type: string; text?: string }[]; model?: string };
    const text = (body.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim();
    return { text, model: body.model ?? this.env.AI_MODEL, simulated: false };
  }

  /** True when no real model is configured; callers use their own labelled stand-in. */
  get simulated() {
    return this.env.AI_PROVIDER === 'mock';
  }

  /**
   * One turn of a tool-using conversation. The caller runs any requested tools itself (with its own
   * permission checks) and calls again with the results. Never used in mock mode.
   */
  async toolTurn(system: string, messages: AiToolMessage[], tools: AiTool[], maxTokens = 1500): Promise<AiToolTurn> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': this.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.env.AI_MODEL, max_tokens: maxTokens, system, messages, tools }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      this.logger.warn(`AI provider error ${res.status}: ${err.slice(0, 300)}`);
      throw aiError(res.status, err);
    }
    const body = (await res.json()) as { content?: AiBlock[]; stop_reason?: string; model?: string };
    return { content: body.content ?? [], stopReason: body.stop_reason ?? 'end_turn', model: body.model ?? this.env.AI_MODEL };
  }

  /** Deterministic, clearly labelled stand-in for development and tests. */
  private mock(system: string, messages: AiMessage[]): AiCompletion {
    const last = messages[messages.length - 1]?.content ?? '';
    const sources = [...system.matchAll(/\[(\d+)\][^\n]*\n([^\n]{0,240})/g)].slice(0, 2);
    let text: string;
    if (system.includes('COMPLAINT_DRAFT')) {
      text =
        '[Simulated draft] Subject: Complaint regarding my purchase\n\nDear Sir/Madam,\n\nI am writing about the issue described below.\n\n' +
        last.slice(0, 1200) +
        '\n\nI request a resolution within 15 days. Please acknowledge this complaint.\n\nRegards';
    } else if (sources.length) {
      text = `[Simulated answer] Based on the sources: ${sources.map((m) => `${m[2].trim()} [${m[1]}]`).join(' ')}`;
    } else {
      text = "[Simulated answer] I couldn't find this in LifeSphere's guidance library. Please check an official source.";
    }
    return { text, model: 'mock', simulated: true };
  }
}

@Injectable()
export class EmbeddingsAdapter {
  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled() {
    return this.env.EMBEDDINGS_PROVIDER !== 'none';
  }

  get model() {
    return this.env.EMBEDDINGS_MODEL;
  }

  async embed(inputs: string[]): Promise<number[][]> {
    if (!this.enabled) throw new Error('Embeddings provider not configured');
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.env.EMBEDDINGS_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.env.EMBEDDINGS_MODEL, input: inputs, dimensions: this.env.EMBEDDINGS_DIMENSIONS }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Embeddings error ${res.status}`);
    const body = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
