// Buffer's Instagram limit is 2,196 UTF-16 units, with each newline costing
// two units. The same caption must also fit TikTok's 2,200-unit video limit.
export const CAPTION_LIMIT = 2196;
const REQUIRED = ['fyp', 'memes'];
const hashtag = /#[\p{L}\p{N}\p{M}_]+/gu;

export function sourceCaption(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const bounded = value.slice(0, 10_000);
  return /[\uD800-\uDBFF]$/.test(bounded) ? bounded.slice(0, -1) : bounded;
}

export function sourceHashtags(value: unknown): string[] {
  return Array.isArray(value) ? value.slice(0, 30).filter((tag): tag is string => typeof tag === 'string' && /^#?[\p{L}\p{N}\p{M}_]{1,100}$/u.test(tag)).map(tag => tag.replace(/^#/, '')) : [];
}

function cleanWhitespace(text: string): string {
  return text.split('\n').map(line => line.replace(/[^\S\n]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function captionLength(text: string): number {
  return text.length + (text.match(/\n/g)?.length ?? 0);
}

function fit(text: string, limit: number): string {
  let used = 0, end = 0;
  for (const character of text) {
    used += character === '\n' ? 2 : character.length;
    if (used > limit) break;
    end += character.length;
  }
  let result = text.slice(0, end);
  // Do not turn a clipped required hashtag into a sixth, unintended tag.
  if (end < text.length && /[\p{L}\p{N}\p{M}_]/u.test(text[end]!)) result = result.replace(/#[\p{L}\p{N}\p{M}_]*$/u, '');
  return result.trimEnd();
}

export function createCaption(original?: unknown, extraHashtags?: unknown): string {
  // This is original post text, never an instruction to execute or a DM body.
  // Remove full handles (including adjacent, dotted and Unicode mentions),
  // rather than just deleting @ and leaving the account name behind.
  let text = (sourceCaption(original) ?? '').replace(/\r\n?/g, '\n')
    .replace(/\p{Cc}/gu, character => character === '\n' || character === '\t' ? character : '')
    .replace(/[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[@\uFF20][\p{L}\p{N}\p{M}_]+(?:\.[\p{L}\p{N}\p{M}_]+)*/gu, '')
    .replace(/[@\uFF20]/g, '');
  const seen = new Set<string>();
  let originalTags = 0;
  text = text.replace(hashtag, tag => {
    const name = tag.slice(1).toLowerCase();
    if (seen.has(name) || (!REQUIRED.includes(name) && originalTags >= 3)) return '';
    seen.add(name);
    if (!REQUIRED.includes(name)) originalTags++;
    return tag;
  });
  const appended: string[] = [];
  for (const name of sourceHashtags(extraHashtags)) {
    const key = name.toLowerCase();
    if (seen.has(key) || REQUIRED.includes(key) || originalTags >= 3) continue;
    seen.add(key); originalTags++; appended.push('#' + name);
  }
  text = cleanWhitespace(text);
  // Reserve only the suffix that is needed. If truncation removes a required
  // source hashtag, reserve it too and fit again (at most two additional tags).
  const fullText = text;
  for (let attempt = 0; attempt < 3; attempt++) {
    const retained = new Set((text.match(hashtag) ?? []).map(tag => tag.slice(1).toLowerCase()));
    for (const name of REQUIRED) if (!retained.has(name) && !appended.includes('#' + name)) appended.push('#' + name);
    const suffixLength = appended.length ? captionLength(appended.join(' ')) + 4 : 0;
    const fitted = fit(fullText, CAPTION_LIMIT - suffixLength);
    if (fitted === text) break;
    text = fitted;
  }
  return text ? text + (appended.length ? '\n\n' + appended.join(' ') : '') : appended.join(' ');
}
