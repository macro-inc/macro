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
