/** Choices compare case-insensitively after trimming surrounding whitespace. */
export function duplicatePollOptions(options: readonly string[]): Set<number> {
  const firstByLabel = new Map<string, number>();
  const duplicates = new Set<number>();
  options.forEach((option, index) => {
    const label = option.trim().toLowerCase();
    if (!label) return;
    const first = firstByLabel.get(label);
    if (first === undefined) firstByLabel.set(label, index);
    else {
      duplicates.add(first);
      duplicates.add(index);
    }
  });
  return duplicates;
}
