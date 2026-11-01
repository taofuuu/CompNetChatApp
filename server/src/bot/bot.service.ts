import { Injectable, Logger } from '@nestjs/common';
import type { Message } from '@compnet/shared';
import { AiClient, type AiMessage } from './ai.client';
import { BOT_NAME } from './bot-name';
import { SYSTEM_PROMPT } from './prompt';

/** How many of a Room's latest Messages the model sees, including the one that mentions it. */
export const BOT_CONTEXT_MESSAGES = 6;
export const BOT_UNAVAILABLE = 'bot is unavailable right now';

/** Whether `text` asks the bot something: it starts with @bot as a whole word, in any case. */
export function mentionsBot(text: string) {
  return /^@bot(\s|$)/i.test(text);
}

/** Turns a Room's Messages into the bot's reply. Knows nothing of sockets or the database. */
@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(private readonly ai: AiClient) {}

  /** Returns the whole reply, calling `onChunk` with each piece. Never throws: any failure becomes BOT_UNAVAILABLE. */
  async reply(history: Message[], onChunk: (text: string) => void) {
    try {
      let reply = '';
      for await (const text of this.ai.stream(toAiMessages(history))) {
        reply += text;
        onChunk(text);
      }
      return reply.trim() || BOT_UNAVAILABLE;
    } catch (err) {
      this.logger.error(err);
      return BOT_UNAVAILABLE;
    }
  }
}

function toAiMessages(history: Message[]): AiMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    // Without the failure notices, or the model may repeat that it is unavailable.
    ...history.filter(({ text }) => text !== BOT_UNAVAILABLE).map(({ sender, text }): AiMessage =>
      sender === BOT_NAME ? { role: 'assistant', content: text } : { role: 'user', content: `${sender}: ${text}` },
    ),
  ];
}
