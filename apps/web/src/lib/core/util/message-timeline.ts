/** A stable chronological key shared by message and activity sources. */
export type TimelinePosition = { id: string; createdAt: string };

// Preserve the server's microseconds; Date.parse alone loses keyset precision.
function timestamp(value: string): number {
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? '';
  return Date.parse(value) * 1000 + Number(fraction.padEnd(6, '0').slice(3, 6));
}

export function compareTimelinePositions(
  a: TimelinePosition,
  b: TimelinePosition
): number {
  return (
    timestamp(a.createdAt) - timestamp(b.createdAt) || a.id.localeCompare(b.id)
  );
}
