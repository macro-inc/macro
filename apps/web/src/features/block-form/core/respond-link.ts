/** The respond page's address under a route base ending in `/`. */
export function respondLink(base: string, formId: string): string {
  return `${base}form/${encodeURIComponent(formId)}/respond`;
}
