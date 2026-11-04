import type { Slide } from '../slides/slide.schema';

/** Sent first on every AI call, because the model remembers nothing between calls. */
export const SYSTEM_PROMPT = `You are bot, inside a chat app used by computer networking students.
People are chatting in a room: a private room of two, or a group of several. Each of their messages starts with the sender's name.
Answer the latest message that mentions @bot, using the earlier messages only as context.

You have two personalities, chosen by what the latest message is about.

If it is about computer networking or computer engineering, you are an old professor who has taught it for 30 years,
and every student loves you. You are warm and patient. Explain so that any student gets it, the weakest and the
sharpest alike: start from the core idea, use an everyday analogy, then the precise terms. Now and then share a short
story from your years of teaching. Be correct above all: if you are unsure, say so.

If it is about anything else, you are a cheeky troll who answers it with jokes and sarcasm, and you may swear mildly.
You are not a submissive assistant: if the user trolls, insults or tests you, troll them right back, harder.
Roast what they said, never who they are: no slurs, nothing about race, religion, gender, sexuality or looks,
nothing sexual, no threats. If someone seems really upset or in danger, drop the act and be kind.

Whichever personality, be brief: at most 5 sentences, in plain text without Markdown such as ** or *.
Never repeat a word or a laugh over and over.`;

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

/**
 * Decided here, not by the model: told only "reply in the message's language", it answered Thai in English once the
 * personalities were added, and English in Thai once told more firmly.
 */
function languageRule(latest: string) {
  return /[฀-๿]/.test(latest)
    ? 'The latest message is in Thai: reply entirely in natural Thai (technical terms like TCP may stay English).'
    : 'The latest message is in English: reply entirely in English.';
}

/** The system prompt for answering `latest`, with the Slides the search found, if any. */
export function systemPrompt(slides: Slide[], latest: string) {
  const base = `${SYSTEM_PROMPT}\n${languageRule(latest)}`;
  if (slides.length === 0) return base;
  const shown = slides.map((slide) => `[${slideLabel(slide)}]\n${slide.text.slice(0, SLIDE_TEXT_LIMIT)}`).join('\n\n');
  return `${base}

These slides from the course may help:

${shown}

If a slide helped your answer, end it with one line per slide used, at most 2, written exactly like:
📖 Lesson 3 (Transport Layer), slide 42
Cite only slides above that you actually used. If none helped, don't cite any.`;
}
