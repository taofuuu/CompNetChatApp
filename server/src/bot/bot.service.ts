import { Injectable, Logger } from '@nestjs/common';
import type { Message } from '@compnet/shared';
import type { Slide } from '../slides/slide.schema';
import { SlidesService } from '../slides/slides.service';
import { AiClient, type AiMessage } from './ai.client';
import { BOT_NAME } from './bot-name';
import { KEYWORDS_PROMPT, systemPrompt } from './prompt';

/** How many of a Room's latest Messages the model sees, including the one that mentions it. */
export const BOT_CONTEXT_MESSAGES = 6;
export const BOT_UNAVAILABLE = 'bot is unavailable right now';
/** How many Slides the model gets. It cites at most 2 of them. */
const SLIDES_SHOWN = 3;
/** Plenty for 8 keywords. */
const KEYWORD_TOKENS = 40;

/** Whether `text` asks the bot something: it starts with @bot, in any case, and no letter, digit or underscore follows. */
export function mentionsBot(text: string) {
  return /^@bot\b/i.test(text);
}

/** Turns a Room's Messages into the bot's reply. Knows nothing of sockets or the database. */
@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly ai: AiClient,
    private readonly slides: SlidesService,
  ) {}

  /** Returns the whole reply, calling `onChunk` with each piece. Never throws: any failure becomes BOT_UNAVAILABLE. */
  async reply(history: Message[], onChunk: (text: string) => void) {
    try {
      const slides = await this.slidesFor(history);
      let reply = '';
      for await (const text of this.ai.stream(toAiMessages(history, slides))) {
        reply += text;
        onChunk(text);
      }
      return reply.trim() || BOT_UNAVAILABLE;
    } catch (err) {
      this.logger.error(err);
      return BOT_UNAVAILABLE;
    }
  }

  /** The Slides that may answer the latest Message. Never throws: without Slides, bot still answers. */
  private async slidesFor(history: Message[]): Promise<Slide[]> {
    if (!this.slides.loaded) return [];
    try {
      // The Message before too, so a follow-up like "and UDP?" still finds something.
      const chat = withoutFailures(history).slice(-2).map(({ sender, text }) => `${sender}: ${text}`).join('\n');
      let keywords = '';
      for await (const text of this.ai.stream([{ role: 'system', content: KEYWORDS_PROMPT }, { role: 'user', content: chat }], KEYWORD_TOKENS)) {
        keywords += text;
      }
      return /^\s*none\s*$/i.test(keywords) ? [] : this.slides.top(keywords, SLIDES_SHOWN);
    } catch (err) {
      this.logger.warn(`No Slides for this reply: ${err}`);
      return [];
    }
  }
}

// Without the failure notices, or the model may repeat that it is unavailable.
function withoutFailures(history: Message[]) {
  return history.filter(({ text }) => text !== BOT_UNAVAILABLE);
}

function toAiMessages(history: Message[], slides: Slide[]): AiMessage[] {
  return [
    { role: 'system', content: systemPrompt(slides) },
    ...withoutFailures(history).map(({ sender, text }): AiMessage =>
      sender === BOT_NAME ? { role: 'assistant', content: text } : { role: 'user', content: `${sender}: ${text}` },
    ),
  ];
}
