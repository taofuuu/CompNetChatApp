import { SlideSearch } from '../src/slides/slide-search';
import type { Slide } from '../src/slides/slide.schema';

// The keyword search bot uses to find the Slides that answer a question.

function slide(lesson: number, slide: number, text: string, lessonName = 'Lesson'): Slide {
  return { lesson, lessonName, slide, text };
}

const slides = [
  slide(2, 1, 'DNS translates host names into IP addresses.'),
  slide(3, 2, 'TCP three-way handshake: SYN, SYN-ACK, ACK.'),
  slide(3, 3, 'UDP has no handshake and no retransmission, unlike TCP.'),
  slide(3, 4, 'TCP flow control uses a receive window. TCP congestion control uses cwnd.'),
  slide(4, 1, 'A router forwards packets by longest prefix match.'),
];
const search = new SlideSearch(slides);

const found = (keywords: string, limit = 3) => search.top(keywords, limit).map(({ lesson, slide }) => `${lesson}.${slide}`);

test('the Slide about the keywords ranks first', () => {
  expect(found('router forwarding packets')[0]).toBe('4.1');
});

test('keywords no Slide contains find nothing', () => {
  expect(found('lunch pizza')).toEqual([]);
});

test('a rare keyword outweighs a common one said twice', () => {
  const rare = new SlideSearch([
    slide(1, 1, 'tcp tcp segment'),
    slide(1, 2, 'handshake'),
    slide(1, 3, 'tcp port'),
    slide(1, 4, 'tcp header'),
    slide(1, 5, 'tcp reset'),
  ]);

  expect(rare.top('tcp handshake', 1)[0].slide).toBe(2);
});

test('a Slide that says a keyword more often ranks higher', () => {
  expect(found('tcp')[0]).toBe('3.4');
});

test('at most limit Slides, every one matching', () => {
  expect(found('tcp', 2)).toHaveLength(2);
  expect(found('tcp', 10).sort()).toEqual(['3.2', '3.3', '3.4']);
});

test('case is ignored', () => {
  expect(found('dns')).toEqual(found('DNS'));
  expect(found('dns')).toEqual(['2.1']);
});

test('prefix lengths, dotted numbers and the Lesson name are searchable', () => {
  const more = new SlideSearch([
    slide(4, 2, 'A /26 mask is 255.255.255.192 with 62 usable hosts.', 'Network Layer'),
    slide(6, 1, 'Wi-Fi is IEEE 802.11.', 'Wireless'),
    slide(6, 2, 'Bluetooth pairs devices.', 'Wireless'),
  ]);
  const hits = (keywords: string) => more.top(keywords, 3).map(({ lesson, slide }) => `${lesson}.${slide}`);

  expect(hits('/26')).toEqual(['4.2']);
  expect(hits('255.255.255.192')).toEqual(['4.2']);
  expect(hits('802.11')).toEqual(['6.1']);
  expect(hits('wireless').sort()).toEqual(['6.1', '6.2']);
});

test('no Slides finds nothing', () => {
  expect(new SlideSearch([]).top('tcp', 3)).toEqual([]);
});
