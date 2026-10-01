const HEX_HYPHENATED_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A hyphenated hex id. First-party bot ids omit the UUID version digit. */
export function isHexHyphenatedId(value: string): boolean {
  return HEX_HYPHENATED_ID.test(value);
}
