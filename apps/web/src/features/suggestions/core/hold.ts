/**
 * The rows in `current`'s order, with each of `held` (rows that settled or
 * were dismissed during the visit, which the server no longer lists there)
 * kept where it was in `previous`: after the nearest row that was above it
 * and is still shown, else first. A held row never shown before goes last.
 */
export function holdInPlace(
  current: readonly string[],
  held: readonly string[],
  previous: readonly string[]
): string[] {
  const rows = [...current];
  for (const [index, id] of previous.entries()) {
    if (!held.includes(id) || rows.includes(id)) continue;

    const above = previous
      .slice(0, index)
      .findLast((other) => rows.includes(other));
    rows.splice(above === undefined ? 0 : rows.indexOf(above) + 1, 0, id);
  }
  for (const id of held) if (!rows.includes(id)) rows.push(id);

  return rows;
}
