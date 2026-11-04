import { isNone } from '../src/bot/bot.service';

// The keyword step's NONE means "not about networking": no Slides.

test.each(['NONE', 'none.', ' NONE\n', 'Keywords: NONE', '"NONE"'])('%p is NONE', (keywords) => {
  expect(isNone(keywords)).toBe(true);
});

test.each(['tcp handshake', 'TLS null cipher none authentication', ''])('%p is not NONE', (keywords) => {
  expect(isNone(keywords)).toBe(false);
});
