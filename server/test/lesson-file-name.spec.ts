import { parseLessonFileName } from '../src/slides/lesson-file-name';

// The ingest script takes each Lesson's number and name from its PDF's file name.

test.each([
  ['03 Transport Layer.pdf', 3, 'Transport Layer'],
  ['3 Transport Layer.pdf', 3, 'Transport Layer'],
  ['10   Network Security .PDF', 10, 'Network Security'],
  ['01 Introduction.pdf', 1, 'Introduction'],
])('%p is Lesson %p, %p', (fileName, lesson, lessonName) => {
  expect(parseLessonFileName(fileName)).toEqual({ lesson, lessonName });
});

test.each(['Transport Layer.pdf', '03.pdf', '03 Transport Layer.pptx', '00 Nothing.pdf', 'Lesson 3 Transport.pdf'])(
  '%p is refused',
  (fileName) => {
    expect(() => parseLessonFileName(fileName)).toThrow(`${fileName}: name it like "03 Transport Layer.pdf".`);
  },
);
