import type { Slide } from './slide.schema';

// BM25, the classic keyword ranking: a Slide scores higher the more often it has a keyword, the rarer that keyword
// is across all Slides, and the shorter the Slide. Standard constants.
const K1 = 1.2;
const B = 0.75;

/**
 * Lower-cased words and numbers. Keeps `802.11`, `255.255.255.0` and `/26` whole; splits `SYN-ACK` into two. A dotted
 * run with letters, like `www.ietf.org` or `datagrams.forwarding` (a PDF that lost a space), also gives its parts.
 */
function words(text: string) {
  return (text.toLowerCase().match(/\/\d+|[a-z0-9]+(?:\.[a-z0-9]+)*/g) ?? []).flatMap((word) =>
    word.includes('.') && /[a-z]/.test(word) ? [word, ...word.split('.')] : [word],
  );
}

/** Finds the Slides that best match some keywords. Everything is in memory: a course has under a thousand Slides. */
export class SlideSearch {
  private readonly counts: Map<string, number>[];
  private readonly lengths: number[];
  private readonly averageLength: number;
  /** How many Slides have each word. */
  private readonly slidesWith = new Map<string, number>();

  constructor(private readonly slides: Slide[]) {
    this.counts = slides.map(({ lessonName, text }) => {
      const counts = new Map<string, number>();
      for (const word of words(`${lessonName} ${text}`)) counts.set(word, (counts.get(word) ?? 0) + 1);
      return counts;
    });
    this.lengths = this.counts.map((counts) => [...counts.values()].reduce((sum, n) => sum + n, 0));
    this.averageLength = this.lengths.reduce((sum, n) => sum + n, 0) / (slides.length || 1);
    for (const counts of this.counts) for (const word of counts.keys()) this.slidesWith.set(word, (this.slidesWith.get(word) ?? 0) + 1);
  }

  get size() {
    return this.slides.length;
  }

  /** The `limit` best Slides for `keywords`, best first. Only Slides with at least one keyword. */
  top(keywords: string, limit: number): Slide[] {
    const query = [...new Set(words(keywords))];
    return this.slides
      .map((slide, i) => ({ slide, score: this.score(query, i) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ slide }) => slide);
  }

  private score(query: string[], i: number) {
    let score = 0;
    for (const word of query) {
      const count = this.counts[i].get(word);
      if (!count) continue;
      const n = this.slidesWith.get(word)!;
      const rarity = Math.log(1 + (this.slides.length - n + 0.5) / (n + 0.5));
      score += (rarity * count * (K1 + 1)) / (count + K1 * (1 - B + (B * this.lengths[i]) / this.averageLength));
    }
    return score;
  }
}
