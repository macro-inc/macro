/** The ledger's counts and the table's row count, as the Responses tab reads them. */
export type ResponseCounts = {
  submitted: number;
  stopped: number;
  /** Stops per gate section, as the ledger counts them. */
  stoppedBySection: { sectionId: string; count: number }[];
  rows: number;
};

export type ResponseTile = { label: string; value: string; hint?: string };

/**
 * Who the form reaches through its channel posts: not shown, still being
 * counted, anyone (a public form), or a number of people. Only a count of
 * the channels' members exists, so it is shown as that, never as a ratio.
 */
export type ChannelReach = 'none' | 'unknown' | 'public' | number;

const count = (value: number) => value.toLocaleString('en-US');

/**
 * Responses, stopped at a gate (per gate), rows, and the people its
 * channel posts reach. The table can hold rows the form did not write, so
 * rows and responses can differ.
 */
export function responseTiles(
  counts: ResponseCounts,
  reach: ChannelReach,
  gateName: (sectionId: string) => string
): ResponseTile[] {
  const byGate = counts.stoppedBySection
    .filter((entry) => entry.count > 0)
    .map((entry) => `${gateName(entry.sectionId)} ${count(entry.count)}`);
  const tiles: ResponseTile[] = [
    { label: 'Responses', value: count(counts.submitted) },
    {
      label: 'Stopped by a screener',
      value: count(counts.stopped),
      hint: byGate.length > 0 ? byGate.join(' · ') : undefined,
    },
    {
      label: 'Rows in the table',
      value: count(counts.rows),
      hint:
        counts.rows !== counts.submitted
          ? 'Includes rows added in the grid'
          : undefined,
    },
  ];
  const label = 'People in its channels';
  if (reach === 'public')
    tiles.push({ label, value: '—', hint: 'Anyone with the link can respond' });
  else if (reach === 'unknown')
    tiles.push({
      label,
      value: '—',
      hint: 'Counting the people in its channels…',
    });
  else if (reach !== 'none')
    tiles.push({
      label,
      value: count(reach),
      hint: 'Can respond through its channel posts, you excluded',
    });
  return tiles;
}
