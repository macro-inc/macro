/** Keep legacy test-phone metadata out of visible author/account names. */
export function displayAuthorName(name: string): string {
  return name.trim().replace(/^(\+\d[\d ()-]*?)\s+\(test number\)$/i, '$1');
}
