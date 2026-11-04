import type { Message } from '@compnet/shared';
import type { AiClient } from '../src/bot/ai.client';
import { BotService } from '../src/bot/bot.service';
import type { Slide } from '../src/slides/slide.schema';
import type { SlidesService } from '../src/slides/slides.service';

// How bot's reply, the keyword step and the Slide search fit together, with a fake AI and fake Slides.

const slide12: Slide = { lesson: 3, lessonName: 'Transport Layer', slide: 12, text: 'TCP three-way handshake' };
const slides = { loaded: true, top: () => [slide12] } as unknown as SlidesService;
const history: Message[] = [
  { roomId: 'alice:bob', sender: 'alice', text: '@bot why a three-way handshake?', createdAt: new Date().toISOString() },
];

/** A fake AI whose calls give these replies in turn; an Error is thrown instead. */
function fakeAi(...replies: (string | Error)[]) {
  return {
    async *stream() {
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      yield reply ?? '';
    },
  } as unknown as AiClient;
}

test('a citation of a Slide the search found is kept, an invented one is dropped', async () => {
  const ai = fakeAi('tcp handshake', 'Answer.\n📖 Lesson 3 (Transport Layer), slide 12\n📖 Lesson 3 (Transport Layer), slide 42');

  expect(await new BotService(ai, slides).reply(history, () => {})).toBe('Answer.\n📖 Lesson 3 (Transport Layer), slide 12');
});

test('when the keyword call fails, bot still answers, without citations', async () => {
  const ai = fakeAi(new Error('Typhoon is down'), 'Answer.\n📖 Lesson 3 (Transport Layer), slide 12');

  expect(await new BotService(ai, slides).reply(history, () => {})).toBe('Answer.');
});
