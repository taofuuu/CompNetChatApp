/** A Lesson's number and name, read from its PDF's file name, e.g. "03 Transport Layer.pdf". */
export function parseLessonFileName(fileName: string) {
  const match = /^(\d+) +(.*?) *\.pdf$/i.exec(fileName);
  const lesson = Number(match?.[1]);
  if (!match || lesson < 1 || !match[2]) throw new Error(`${fileName}: name it like "03 Transport Layer.pdf".`);
  return { lesson, lessonName: match[2] };
}
