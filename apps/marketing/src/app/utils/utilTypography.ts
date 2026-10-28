/** Keep a short final word pair together without forcing long URLs to overflow. */
export function keepLastWords(text: string, maxPairLength = 32): string {
  return text.replace(
    /(\S+)\s+(\S+)(\s*)$/,
    (match, penultimate: string, last: string, trailing: string) =>
      penultimate.length + last.length <= maxPairLength
        ? `${penultimate}\u00a0${last}${trailing}`
        : match
  );
}
