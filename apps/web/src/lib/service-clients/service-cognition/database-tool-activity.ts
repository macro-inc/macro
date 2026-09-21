/** Receipts are produced by the server from executed tools, never model output. */
export function summarizeDatabaseActivity(
  activity: {
    name: string;
    success: boolean;
    changesApplied?: number | null;
  }[]
): string | undefined {
  const successful = activity.filter((entry) => entry.success);
  const count = (name: string) =>
    successful.filter((entry) => entry.name === name).length;
  const summaries: string[] = [];
  for (const [tool, label] of [
    ['CreateDatabase', 'database'],
    ['CreateTable', 'table'],
    ['AddColumn', 'column'],
    ['SaveDatabaseView', 'view'],
  ]) {
    const total = count(tool);
    if (total)
      summaries.push(
        `${tool === 'SaveDatabaseView' ? 'Saved' : tool === 'AddColumn' ? 'Added' : 'Created'} ${total} ${label}${total === 1 ? '' : 's'}`
      );
  }
  if (count('AddColumnOptions')) summaries.push('Added select options');
  const changed = successful.reduce(
    (total, entry) =>
      total +
      (entry.name === 'QueryDatabase' ? (entry.changesApplied ?? 0) : 0),
    0
  );
  if (changed)
    summaries.push(`Applied ${changed} row change${changed === 1 ? '' : 's'}`);
  return summaries.length ? `${summaries.join(' · ')}.` : undefined;
}
