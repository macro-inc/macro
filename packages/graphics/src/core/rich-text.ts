/** Host-defined text content. Graphics stores this string verbatim and never
 * interprets its format; the host owns validation, editing and rendering. */
export type RichText = string;

/** Bound stored payloads without imposing an editor schema or empty-text policy. */
export function validRichText(value: unknown): value is RichText {
  return typeof value === 'string' && value.length <= 2_000_000;
}
