import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { extractText, getDocumentProxy } from 'unpdf';
import { parseLessonFileName } from './lesson-file-name';
import { Slide, SlideSchema } from './slide.schema';

// Run by hand: npm run slides:ingest -w server -- <folder of Lesson PDFs>
// Replaces every Slide in the database with the PDFs' pages. The Slides never go into git: the repo is public.

/** Fewer characters than this and a Slide is probably a picture, which the search can't see. */
const NEARLY_EMPTY = 40;

/** Every page of every Lesson PDF in `folder`, as Slides. */
export async function readSlides(folder: string): Promise<Slide[]> {
  const fileNames = (await readdir(folder)).filter((name) => name.toLowerCase().endsWith('.pdf'));
  if (fileNames.length === 0) throw new Error(`No PDFs in ${folder}.`);
  const lessons = fileNames.map((fileName) => ({ fileName, ...parseLessonFileName(fileName) }));
  const taken = new Map<number, string>();
  for (const { fileName, lesson } of lessons) {
    if (taken.has(lesson)) throw new Error(`${taken.get(lesson)} and ${fileName} are both Lesson ${lesson}.`);
    taken.set(lesson, fileName);
  }

  const slides: Slide[] = [];
  for (const { fileName, lesson, lessonName } of lessons) {
    const pdf = await getDocumentProxy(new Uint8Array(await readFile(join(folder, fileName))));
    const { text: pages } = await extractText(pdf, { mergePages: false });
    pages.forEach((page, i) => slides.push({ lesson, lessonName, slide: i + 1, text: page.replace(/\s+/g, ' ').trim() }));
  }
  return slides;
}

/** One line per Lesson: how many Slides, and how many came out nearly empty. */
export function report(slides: Slide[]) {
  const byLesson = new Map<number, Slide[]>();
  for (const slide of slides) {
    if (!byLesson.has(slide.lesson)) byLesson.set(slide.lesson, []);
    byLesson.get(slide.lesson)!.push(slide);
  }
  return [...byLesson.values()]
    .sort((a, b) => a[0].lesson - b[0].lesson)
    .map((lesson) => {
      const empty = lesson.filter(({ text }) => text.length < NEARLY_EMPTY).length;
      return `Lesson ${lesson[0].lesson} (${lesson[0].lessonName}): ${lesson.length} Slides, ${empty} nearly empty`;
    });
}

async function main() {
  const folder = process.argv[2];
  if (!folder) throw new Error('Usage: npm run slides:ingest -w server -- <folder of Lesson PDFs>');
  if (existsSync('.env')) process.loadEnvFile();
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set: copy server/.env.example to server/.env and fill it in.');

  // Read everything first, so a bad PDF leaves the database as it was.
  const slides = await readSlides(folder);
  await mongoose.connect(uri);
  try {
    // Into a new collection first, then swapped in by a rename, so a failed run leaves the old Slides in place.
    const fresh = mongoose.model('FreshSlide', SlideSchema, 'slides_fresh');
    await fresh.deleteMany({});
    await fresh.init();
    await fresh.insertMany(slides);
    await fresh.collection.rename(mongoose.model(Slide.name, SlideSchema).collection.collectionName, { dropTarget: true });
  } finally {
    await mongoose.disconnect();
  }
  console.log(report(slides).join('\n'));
  console.log(`Saved ${slides.length} Slides. Restart the server to use them.`);
}

if (require.main === module) {
  main().catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
