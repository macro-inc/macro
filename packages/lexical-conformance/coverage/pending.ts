/** A pending baseline permits staged work, never a regression or an unlisted gap. */
export function pendingErrors(
  pending: ReadonlySet<string>,
  known: ReadonlySet<string>,
  baseline: ReadonlySet<string> | undefined,
  uncovered: ReadonlySet<string>
): string[] {
  const errors: string[] = [];
  for (const id of pending) {
    if (!known.has(id)) errors.push(`Unknown pending row: ${id}`);
    if (baseline && !baseline.has(id))
      errors.push(`Pending ratchet grew: ${id}`);
  }
  for (const id of uncovered)
    if (!pending.has(id))
      errors.push(`Required row lacks verified execution: ${id}`);
  return errors;
}
