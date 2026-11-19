import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const T = '/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b/apps/web/tests/channels-e2e';
const sub = (file: string, a: string, b: string) => {
  const p = T + '/' + file;
  const t = readFileSync(p, 'utf8');
  if (!t.includes(a)) throw new Error('missing in ' + file + ': ' + a.slice(0, 40));
  writeFileSync(p, t.replace(a, b));
};
appendFileSync(T + '/harness/network.ts', `
/** The requests a page reads its list of channels with, a hundred to a page. */
const CHANNEL_LIST = '**/dss/comms/channels?**';

/**
 * Resolves when the page has read its whole list of channels. Start it before
 * the page opens. A person with thousands of channels reads the list for
 * seconds, and a rename saved meanwhile never shows in the header (CHN-16);
 * a cast that has run the suite some forty times is such a person.
 */
export function channelListRead(page: Page): Promise<void> {
  return page
    .waitForResponse(
      async (response) => {
        if (!response.url().includes('/dss/comms/channels?')) return false;
        if (!response.ok()) return false;
        const body: { next_cursor?: string | null } = await response.json();
        return !body.next_cursor;
      },
      { timeout: 120_000 }
    )
    .then(() => undefined);
}

/**
 * Holds back the answers to the page's reading of its list of channels: the
 * services have answered, the page has not been told. Returns the step that
 * lets them through, which first waits for one to be held.
 */
export async function holdChannelList(page: Page): Promise<() => Promise<void>> {
  const held: Array<() => void> = [];
  let holding = true;
  await page.route(CHANNEL_LIST, async (route) => {
    const answer = await route.fetch();
    if (holding) await new Promise<void>((letGo) => held.push(letGo));
    try {
      await route.fulfill({ response: answer });
    } catch {
      // the page that asked is gone
    }
  });
  return async () => {
    await expect
      .poll(() => held.length, { message: 'an answer is held back' })
      .toBeGreaterThan(0);
    holding = false;
    for (const letGo of held) letGo();
  };
}
`);
sub('channels.spec.ts', "import { ChannelView, conversations } from './harness/channel';\n", "import { ChannelView, conversations } from './harness/channel';\nimport { channelListRead, holdChannelList } from './harness/network';\n");
sub('channels.spec.ts', `  const view = new ChannelView(page, channel.id);
  await view.open();
  const benPage = await pageFor('ben');
  const benView = new ChannelView(benPage, channel.id);
  await benView.open();

  await chooseChannelAction(page, 'Rename');`, `  const view = new ChannelView(page, channel.id);
  const listed = channelListRead(page);
  await view.open();
  const benPage = await pageFor('ben');
  const benView = new ChannelView(benPage, channel.id);
  await benView.open();
  // A rename saved while the list is still being read is CHN-16's.
  await listed;

  await chooseChannelAction(page, 'Rename');`);
appendFileSync(T + '/channels.spec.ts', `
test('CHN-16 a rename saved while the list of channels is still being read shows in the header', async ({
  page,
  ada,
  people,
}) => {
  knownDefect('both');
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['before the rename']);
  const renamed = unique('renamed');

  const letThrough = await holdChannelList(page);
  const view = new ChannelView(page, channel.id);
  await view.open();
  await chooseChannelAction(page, 'Rename');
  const dialog = page.getByRole('dialog', { name: 'Rename item' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill(renamed);
  await dialog.getByRole('button', { name: 'Save name' }).click();
  await expect(dialog).toBeHidden();
  await letThrough();

  await expect(channelHeader(page)).toContainText(renamed);
});
`);
sub('ledger/inventory.tsv', 'is announced\tCHN-03,CHN-04\t', 'is announced\tCHN-03,CHN-04,CHN-16\t');
appendFileSync(T + '/ledger/known-defects.tsv', 'CHN-16\tboth\tA rename saved while the page is still reading its list of channels never shows in the header until a reload: the list answered before the rename puts the old name back and is not read again. A person with thousands of channels reads the list for seconds after every load\n');
appendFileSync(T + '/ledger/proofs.tsv', 'CHN-16\tnone: the build as it is, with or without the flag\tfailed: Error: expect(locator).toContainText(expected) failed\n');
