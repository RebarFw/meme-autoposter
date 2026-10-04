import { expect, it } from 'vitest';
import { CAPTION_LIMIT, captionLength, createCaption, sourceCaption, sourceHashtags } from '../src/caption';

it('preserves the original title, emoji, line breaks and hashtags while removing entire mentions', () => {
  expect(createCaption('When the weekend ends 😂 @friend.name\nSame every Monday @someone_else\n\n#relatable #WorkLife'))
    .toBe('When the weekend ends 😂\nSame every Monday\n\n#relatable #WorkLife\n\n#fyp #memes');
});

it('removes adjacent, fullwidth, Unicode and obscured mentions without leaving account names', () => {
  const result = createCaption('That reaction @first@second ＠third @اسم_حساب @user\u200Bname @name_2. #ضحك');
  expect(result).toBe('That reaction . #ضحك\n\n#fyp #memes');
  expect(result).not.toMatch(/[@＠]|first|second|third|username|name_2|اسم_حساب/);
});

it('keeps three original hashtags, deduplicates required tags and supplements missing provider hashtags', () => {
  const result = createCaption('Original #Dogs #dogs #PETS #cute #four #FYP #memes #fyp', ['Dogs', 'other']);
  expect(result).toBe('Original #Dogs #PETS #cute #FYP #memes');
  expect(createCaption('Original title', ['funny', '#animals', 'FUNNY', 'fyp', 'pets', 'extra']))
    .toBe('Original title\n\n#funny #animals #pets #fyp #memes');
});

it('uses hashtags alone when the original caption is empty, absent or only mentions', () => {
  for (const value of [undefined, null, '', '@someone', 123, { text: 'fake caption' }]) expect(createCaption(value)).toBe('#fyp #memes');
  expect(createCaption(undefined, ['funny'])).toBe('#funny #fyp #memes');
});

it('bounds malicious metadata and discards invalid hashtag fields', () => {
  expect(sourceCaption({ caption: 'untrusted object' })).toBeUndefined();
  expect(sourceCaption('x'.repeat(20_000))).toHaveLength(10_000);
  expect(sourceHashtags(['okay', '@mention', 'two words', 'a'.repeat(101), null, 'ضحك', '#meme'])).toEqual(['okay', 'ضحك', 'meme']);
  expect(sourceHashtags({ hashtags: ['wrong'] })).toEqual([]);
  expect(createCaption('Hello\u0000\u202E world\r\n\r\n\r\n#funny')).toBe('Hello world\n\n#funny\n\n#fyp #memes');
});

it('fits both Buffer channels with weighted newlines, intact emoji and required hashtags after truncation', () => {
  const alreadyFits = 'x'.repeat(2180) + ' #fyp #memes';
  expect(createCaption(alreadyFits)).toBe(alreadyFits);
  for (const original of ['😂'.repeat(4000), 'line\n'.repeat(2000) + '#fyp #memes', '#one #two #three ' + 'x'.repeat(2136) + ' #memes']) {
    const result = createCaption(original);
    expect(captionLength(result)).toBeLessThanOrEqual(CAPTION_LIMIT);
    expect(result.length).toBeLessThanOrEqual(2200);
    expect(result).toMatch(/#fyp\b/i);
    expect(result).toMatch(/#memes\b/i);
    expect(result.match(/#[\p{L}\p{N}\p{M}_]+/gu)!.length).toBeLessThanOrEqual(5);
    expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  }
});
