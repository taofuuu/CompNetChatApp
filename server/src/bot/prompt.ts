import type { Slide } from '../slides/slide.schema';

/** Sent first on every AI call, because the model remembers nothing between calls. */
export const SYSTEM_PROMPT = `You are bot, a helpful assistant inside a chat app used by computer networking students.
Two people are chatting in a private room. Each of their messages starts with the sender's name.
Answer the latest message that mentions @bot, using the earlier messages only as context.
Reply in the language of that message: Thai if it is in Thai, English if it is in English.
Be brief: at most 5 sentences, in plain text without Markdown.`;

/** Asks for the words to search the Slides with. NONE keeps casual chat from citing Slides. */
export const KEYWORDS_PROMPT = `You pick search keywords for a computer networking course's lecture slides, which are in English.
You get the last messages of a chat; the last one asks @bot something.
If it is about computer networking, reply with 3 to 8 English keywords for it, separated by spaces, and nothing else.
Translate Thai to English, and use the earlier message to understand a short follow-up like "and UDP?".
If it is not about computer networking, reply with exactly: NONE`;

/** How a Slide is named to the model and in citations. */
export function slideLabel({ lesson, lessonName, slide }: Slide) {
  return `Lesson ${lesson} (${lessonName}), slide ${slide}`;
}

/** Enough for a dense Slide; keeps one odd Slide from filling the prompt. */
const SLIDE_TEXT_LIMIT = 1000;

/** The system prompt, with the Slides the search found, if any. */
export function systemPrompt(slides: Slide[]) {
  if (slides.length === 0) return SYSTEM_PROMPT;
  const shown = slides.map((slide) => `[${slideLabel(slide)}]\n${slide.text.slice(0, SLIDE_TEXT_LIMIT)}`).join('\n\n');
  return `${SYSTEM_PROMPT}

These slides from the course may help:

${shown}

If a slide helped your answer, end it with one line per slide used, at most 2, written exactly like:
📖 Lesson 3 (Transport Layer), slide 42
Cite only slides above that you actually used. If none helped, don't cite any.`;
}
