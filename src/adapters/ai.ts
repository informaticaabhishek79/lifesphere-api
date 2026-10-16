import { Inject, Injectable } from '@nestjs/common';
import { Env, ENV } from '../config/env';

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
@Injectable()
export class AiAdapter {
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
      throw new Error(`AI provider error ${res.status}: ${err.slice(0, 200)}`);
    }
    const body = (await res.json()) as { content?: { type: string; text?: string }[]; model?: string };
    const text = (body.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim();
    return { text, model: body.model ?? this.env.AI_MODEL, simulated: false };
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
