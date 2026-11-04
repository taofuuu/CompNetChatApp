import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

/** One entry of the conversation sent to the model. */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** How long the model may stay silent, before its first word or between two words. */
const SILENCE_LIMIT_MS = 10_000;
const MAX_REPLY_TOKENS = 500;

/** The only file that talks to the AI. Any OpenAI-compatible API works, chosen by the AI_* environment variables. */
@Injectable()
export class AiClient {
  /** Yields the model's reply piece by piece. Throws if it fails or falls silent for `silenceMs`. */
  async *stream(
    messages: AiMessage[],
    { maxTokens = MAX_REPLY_TOKENS, silenceMs = SILENCE_LIMIT_MS } = {},
  ): AsyncGenerator<string> {
    const { AI_BASE_URL: baseURL, AI_MODEL: model, AI_API_KEY: apiKey } = process.env;
    // All three, or the SDK would fall back to OpenAI's own address.
    if (!baseURL || !model || !apiKey) throw new Error('AI_BASE_URL, AI_MODEL and AI_API_KEY must be set.');

    // maxRetries 0: a retry would stretch the wait past the silence limit.
    const client = new OpenAI({ baseURL, apiKey, maxRetries: 0 });
    const abort = new AbortController();
    let silence = setTimeout(() => abort.abort(), silenceMs);
    try {
      const stream = await client.chat.completions.create(
        { model, messages, stream: true, max_tokens: maxTokens },
        { signal: abort.signal },
      );
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta.content;
        if (!text) continue;
        clearTimeout(silence);
        silence = setTimeout(() => abort.abort(), silenceMs);
        yield text;
      }
    } finally {
      clearTimeout(silence);
    }
  }
}
