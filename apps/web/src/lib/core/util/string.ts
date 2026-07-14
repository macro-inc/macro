/** truncates a string to a given length
 * if the string required truncation, it will append an ellipsis
 * @param str - the string to truncate
 * @param maxLength - the maximum length of the string
 * @returns the truncated string
 *
 * @example
 * truncate('Hello World', 10); // 'Hello...'
 */
export function truncateString(str: string, maxLength: number) {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

const DEFAULT_LABEL_MAX_CHARS = 30;

/**
 * Truncates a display label to a max character count, appending a single
 * ellipsis character (`…`). Used for chip labels, display names, and other
 * UI labels where character-based truncation is preferred over CSS truncation.
 */
export function truncateLabel(raw: string, max = DEFAULT_LABEL_MAX_CHARS) {
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
}

let encoder: TextEncoder;
/**
 * Encodes a string to UTF-8 bytes
 * @param text - the string to encode
 * @returns the UTF-8 encoded bytes
 */
export function utf8Encode(text: string) {
  if (!encoder) encoder = new TextEncoder();
  return encoder.encode(text);
}

let decoder: TextDecoder;
/**
 * Decodes a array buffer to a string
 */
export function bufToString(buf: ArrayBuffer) {
  if (!decoder) decoder = new TextDecoder();
  return decoder.decode(buf);
}

/**
 * Pluralize a string if the `length` is great than 1
 */
export function plural(singular: string, length: number, suffix = 's') {
  if (!singular.length) return singular;

  if (length === 1) return singular;

  return `${singular}${suffix}`;
}

/**
 * Regex pattern to match emoji-only strings.
 * Uses alternation to match:
 * - Extended pictographic characters (most emojis)
 * - Emoji presentation characters
 * - Variation selectors (\uFE0F)
 * - Zero-width joiners (\u200D) for composite emojis (e.g., family emoji)
 * - Whitespace
 */
const EMOJI_ONLY_REGEX =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\uFE0F|\u200D|\s)+$/u;

/**
 * Checks if a string contains only emoji characters (and whitespace).
 * Returns true for messages like "🎉", "👍👍👍", "🎊 🎉", etc.
 * Returns false for messages with any text, links, or other content.
 *
 * @param text - the string to check
 * @returns true if the string contains only emojis (and whitespace)
 *
 * @example
 * isEmojiOnly('🎉'); // true
 * isEmojiOnly('👨‍👩‍👧‍👦'); // true (family emoji)
 * isEmojiOnly('Hello 👋'); // false
 * isEmojiOnly(''); // false
 */
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return EMOJI_ONLY_REGEX.test(trimmed);
}
