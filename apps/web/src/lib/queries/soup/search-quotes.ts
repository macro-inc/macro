/**
 * The text with curly double quotes as straight ones, as the search service
 * reads them: phones and Macs type them in their place.
 */
export function straightenQuotes(text: string): string {
  return text.replace(/[“”„]/g, '"');
}
