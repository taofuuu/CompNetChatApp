import { keepCitationsOf, withoutCitations } from '../src/bot/citations';
import type { Slide } from '../src/slides/slide.schema';

// bot cites only the Slides it was given, and its earlier citations are hidden from the model.

const given: Slide[] = [
  { lesson: 3, lessonName: 'Transport Layer', slide: 12, text: '' },
  { lesson: 3, lessonName: 'Transport Layer', slide: 13, text: '' },
  { lesson: 4, lessonName: 'Network Layer', slide: 2, text: '' },
];

test('a citation of a given Slide is kept', () => {
  expect(keepCitationsOf('TCP uses a handshake.\n📖 Lesson 3 (Transport Layer), slide 12', given)).toBe(
    'TCP uses a handshake.\n📖 Lesson 3 (Transport Layer), slide 12',
  );
});

test('an invented citation is dropped', () => {
  expect(keepCitationsOf('TCP uses a handshake.\n📖 Lesson 3 (Transport Layer), slide 42', given)).toBe('TCP uses a handshake.');
});

test('with no Slides given, every citation is dropped', () => {
  expect(keepCitationsOf('Try pad thai.\n  📖 Lesson 3 (Transport Layer), slide 12', [])).toBe('Try pad thai.');
});

test('at most 2 citations', () => {
  const reply = 'Answer.\n📖 Lesson 3 (Transport Layer), slide 12\n📖 Lesson 3 (Transport Layer), slide 13\n📖 Lesson 4 (Network Layer), slide 2';
  expect(keepCitationsOf(reply, given)).toBe('Answer.\n📖 Lesson 3 (Transport Layer), slide 12\n📖 Lesson 3 (Transport Layer), slide 13');
});

test('withoutCitations leaves only the answer', () => {
  expect(withoutCitations('Answer.\n📖 Lesson 3 (Transport Layer), slide 12')).toBe('Answer.');
  expect(withoutCitations('📖 Lesson 3 (Transport Layer), slide 12')).toBe('');
});
