import type { Slide } from '../slides/slide.schema';
import { slideLabel } from './prompt';

const CITATION = '📖';
/** As the prompt asks. */
const MAX_CITATIONS = 2;

/**
 * `reply` with only the citations of Slides in `slides`, at most 2. The prompt alone doesn't stop the model inventing one,
 * e.g. by copying the prompt's example.
 */
export function keepCitationsOf(reply: string, slides: Slide[]) {
  const labels = new Set(slides.map(slideLabel));
  let cited = 0;
  return reply
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith(CITATION)) return true;
      return labels.has(trimmed.slice(CITATION.length).trim()) && ++cited <= MAX_CITATIONS;
    })
    .join('\n')
    .trim();
}

/** Without bot's earlier citations: seeing them, the model writes new ones even when it was given no Slides. */
export function withoutCitations(text: string) {
  return keepCitationsOf(text, []);
}
