import { readFileSync, writeFileSync } from 'node:fs';
const sub = (file: string, a: string, b: string) => {
  const t = readFileSync(file, 'utf8');
  if (!t.includes(a)) throw new Error('missing in ' + file + ': ' + a.slice(0, 50));
  writeFileSync(file, t.replace(a, b));
};
sub('direct-messages.spec.ts', `  await failsSometimesWithSoup(async () => {
    await expect(cyRow).toContainText('Ada Owner');
    await cyRow.getByRole('treeitem').click();
    const cyView = new ChannelView(cyPage, id);
    await cyView.shown();
    await cyView.expectEndsWith([first, second]);
  });
`, `  await failsSometimesWithSoup(async () => {
    await expect(cyRow).toContainText('Ada Owner');
  });
  const cyView = new ChannelView(cyPage, id);
  await cyView.open();
  await cyView.expectEndsWith([first, second]);
`);
sub('offline.spec.ts', `  // Defect, in some runs: only the first three replies show.
  await failsSometimes(async () => {`, `  await expect
    .poll(async () => (await offline.replies(root.id)).slice(0, 3))
    .toEqual(replies.slice(0, 3));
  // Defect, in some runs: only the first three replies show.
  await failsSometimes(async () => {`);
sub('AGENTS.md', `  "Conversation unavailable" offline (OFF-04, OFF-12). Judge those two from
  whole runs, or from repeats short enough to stay under a hundred channels.`, `  "Conversation unavailable" offline (OFF-04, OFF-12). Judge those two from
  whole runs, or from repeats short enough to stay under a hundred channels,
  and give each run a run directory of its own: a run that finds an earlier
  run's \`history\` channel in its directory reads one that old.`);
