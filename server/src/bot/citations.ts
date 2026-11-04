import type { Slide } from '../slides/slide.schema';
import { slideLabel } from './prompt';

/** As the prompt asks. */
const MAX_CITATIONS = 2;

/**
 * `reply` with only the citations of Slides in `slides`, at most 2. The prompt alone doesn't stop the model inventing one,
 * e.g. by copying the prompt's example.
 */
export function keepCitationsOf(reply: string, slides: Slide[]) {
  const labels = new Set(slides.map(slideLabel));
  let cited = 0;
  // Every 📖, wherever it is: the model doesn't always put a citation on its own line.
  return reply
    .replace(/📖([^\n📖]*)/gu, (citation, label: string) => (labels.has(label.trim()) && ++cited <= MAX_CITATIONS ? citation : ''))
    .trim();
}

/** Without bot's earlier citations: seeing them, the model writes new ones even when it was given no Slides. */
export function withoutCitations(text: string) {
  return keepCitationsOf(text, []);
}
