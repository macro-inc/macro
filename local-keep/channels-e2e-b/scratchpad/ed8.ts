import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const sub = (file: string, a: string, b: string) => {
  const t = readFileSync(file, 'utf8');
  if (!t.includes(a)) throw new Error('missing in ' + file + ': ' + a.slice(0, 50));
  writeFileSync(file, t.replace(a, b));
};
// MEM-03
sub('members.spec.ts', `  // Not with VITE_ENABLE_GRAPHQL_SOUP: there the channel closes at once.
  knownDefect('off');`, `  // With VITE_ENABLE_GRAPHQL_SOUP the same shows in some runs only.
  knownDefect('off');`);
sub('members.spec.ts', `  await expect(cyView.composer).toHaveCount(0);
  await expect(noAccess(cyPage)).toBeVisible();
  await expect(cyPage.getByText('all three here')).toHaveCount(0);`, `  await failsSometimesWithSoup(async () => {
    await expect(cyView.composer).toHaveCount(0);
    await expect(noAccess(cyPage)).toBeVisible();
    await expect(cyPage.getByText('all three here')).toHaveCount(0);
  });`);
// DM-02
sub('direct-messages.spec.ts', `  await expect(cyRow).toContainText('Ada Owner');
  await cyRow.getByRole('treeitem').click();
  const cyView = new ChannelView(cyPage, id);
  await cyView.shown();
  await cyView.expectEndsWith([first, second]);
`, `  // Defect with VITE_ENABLE_GRAPHQL_SOUP: the first conversation these two
  // ever have does not reach the other person's open list, so this shows
  // once for each cast in the life of a stack.
  await failsSometimesWithSoup(async () => {
    await expect(cyRow).toContainText('Ada Owner');
    await cyRow.getByRole('treeitem').click();
    const cyView = new ChannelView(cyPage, id);
    await cyView.shown();
    await cyView.expectEndsWith([first, second]);
  });
`);
// OFF-06
sub('offline.spec.ts', `  const offline = await openOffline(page, channel);
  await offline.hiddenReplies(root.id).click();

  await expect.poll(() => offline.replies(root.id)).toEqual(replies);
});`, `  const offline = await openOffline(page, channel);
  await offline.hiddenReplies(root.id).click();

  // Defect, in some runs: only the first three replies show.
  await failsSometimes(async () => {
    await expect.poll(() => offline.replies(root.id)).toEqual(replies);
  });
});`);
// OFF-13
sub('offline.spec.ts', `// If this fails, a person cannot go back to an old message they followed a
// link to while connected:`, `// If this fails, a person with many channels cannot open, with no
// connection, a channel their device holds once a hundred others are newer.
test('OFF-13 a channel read while connected opens with no connection after a hundred and twenty newer ones were made', async ({
  page,
  ada,
  ben,
}) => {
  // Known defect: after a reload with no connection the page knows only the
  // hundred channels written in or made last, and says "Conversation
  // unavailable" for an older one although the device holds its messages.
  knownDefect('on');
  test.setTimeout(240_000);
  const elsewhere = await ada.createChannel({ members: [ben.person] });
  await ada.post(elsewhere.id, 'elsewhere');
  const old = await ada.createChannel({ members: [ben.person] });
  await ada.post(old.id, 'in the old channel');
  const view = new ChannelView(page, old.id);
  await view.open();
  await expectShown(view, ['in the old channel']);
  await findRow(page, elsewhere);
  await openFromList(page, elsewhere);
  await page.goBack();
  await expectShown(view, ['in the old channel']);
  for (let made = 0; made < 120; made += 1) {
    await ada.createChannel({ members: [ben.person] });
  }
  await ada.post(elsewhere.id, 'elsewhere again');
  await startAfresh(page, elsewhere);

  await goOffline(page.context());
  await page.goBack();

  await view.shown();
  await expectShown(view, ['in the old channel']);
});

// If this fails, a person cannot go back to an old message they followed a
// link to while connected:`);
sub('ledger/inventory.tsv', `device-jump-offline\t`, `device-many-channels-offline\tA held channel opens offline however many newer channels the person has\tOFF-13\t\ndevice-jump-offline\t`);
sub('ledger/proofs.tsv', `OFF-12\tledger/breaks/device-not-used.patch\t`, `OFF-13\tnone: the build as it is, with the flag\tfailed: Error: expect(locator).toBeVisible() failed\nOFF-12\tledger/breaks/device-not-used.patch\t`);
appendFileSync('ledger/known-defects.tsv', `OFF-13\ton\tWith no connection after a reload, a channel the device holds says "Conversation unavailable" once about a hundred other channels of the person's are newer (held with 95 newer, not with 120; leaving the device alone 30 s first changes nothing). main with the flag opens no channel offline at all\n`);
appendFileSync('ledger/intermittent-defects.tsv', `MEM-03\tWith VITE_ENABLE_GRAPHQL_SOUP a person removed from a channel sometimes keeps it open, with its composer, until reload (5 of 10 whole-suite runs and 1 of 30 repeats on da4308dd82; 2 of 30 on main's bundle with the flag); without the flag it is so in every run
OFF-06\tWith VITE_ENABLE_GRAPHQL_SOUP a long thread read while connected sometimes shows only its first three replies with no connection (4 of 10 whole-suite runs on da4308dd82, none in 20 on 94876dc650)
DM-02\tWith VITE_ENABLE_GRAPHQL_SOUP the first conversation two people ever have, started from "New direct message", does not reach the other person's open list (each cast's first run on a new stack, 4 of 4; once of once on main's bundle with the flag; shown at once without the flag)
`);
