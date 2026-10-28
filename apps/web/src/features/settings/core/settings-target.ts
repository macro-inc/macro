/** Shared by the search catalog and the actual section/row markup. */
export function settingsTarget(label?: string): string | undefined {
  return label
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
