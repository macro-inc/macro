import type { Page } from '@playwright/test';
import type { Api } from './harness/api';
import { unique } from './harness/api';
import { ChannelView } from './harness/channel';
import {
  couldNotLoad,
  expectShown,
  findRow,
  leaveAlone,
  type Named,
  openFromList,
  readAndReturn,
  startAfresh,
} from './harness/device';
import { expect, SOUP_BUILD, test } from './harness/fixtures';
import { historyText } from './harness/history';
import { Conversation } from './harness/messages';
import { blockWrites, goOffline } from './harness/network';
import { serverChannel } from './harness/server';
import { findConversations, haveViewed } from './harness/sidebar';

test.skip(!SOUP_BUILD, 'channels are kept on the device only with the flag');

const DAY = 86_400_000;

function logConsole(page: Page, tag: string) {
  page.on('console', (m) => {
    const t = m.text();
    if (/prewarm|evict|storage|reset|mutation_queue/.test(t))
      console.log(`[${tag}] ${t.slice(0, 400)}`);
  });
}

/** Channels of Ada's and Ben's whose names end in the given labels. */
async function named(ada: Api, ben: Api, labels: string[]): Promise<Named[]> {
  const stem = unique('lim');
  const made: Named[] = [];
  for (const label of labels) {
    made.push(
      await ada.createChannel({
        name: `${stem}-${label}`,
        members: [ben.person],
      })
    );
  }
  return made;
}

test('P-LINK a link in a message, clicked offline', async ({
  page,
  ada,
  ben,
  history,
}) => {
  test.setTimeout(180_000);
  logConsole(page, 'link');
  const target = history.messages[14];
  const elsewhere = await ada.createChannel({ members: [ben.person] });
  const origin = new URL(test.info().project.use.baseURL ?? '').origin;
  await ada.post(
    elsewhere.id,
    `${origin}/app/channel/${history.id}?channel_message_id=${target.id}`
  );
  const view = new ChannelView(page, history.id);
  await view.open({ messageId: target.id });
  await expect(view.messageById(target.id)).toBeInViewport();
  await startAfresh(page, elsewhere);
  console.log(
    'LINKHTML',
    await page
      .locator('[data-message-content]')
      .last()
      .evaluate((el) => el.outerHTML.slice(0, 800))
  );
  await goOffline(page.context());
  await page.locator('[data-message-content] a').last().click();
  await view.shown();
  await expect(view.messageById(target.id)).toBeInViewport({ timeout: 20_000 });
  const texts = await view.texts();
  console.log('LINKTEXTS', JSON.stringify(texts));
  const at = texts.indexOf(historyText(15));
  expect(texts.slice(at - 3, at + 4)).toEqual(
    [12, 13, 14, 15, 16, 17, 18].map(historyText)
  );
});

test('P-UNREAD forty unread', async ({ pageFor, ada, ben }) => {
  test.setTimeout(400_000);
  const labels = Array.from(
    { length: 41 },
    (_, index) => `${index < 2 ? 'edge' : 'more'}${String(index).padStart(2, '0')}`
  );
  const fillers = await named(
    ada,
    ben,
    Array.from({ length: 20 }, (_, index) => `seen${index}`)
  );
  const unread = await named(ada, ben, labels);
  await haveViewed('ben', unread[0].id);
  for (const filler of fillers) await haveViewed('ben', filler.id);
  for (const [index, channel] of unread.entries()) {
    await ada.post(channel.id, `unread ${index}`);
  }
  const page = await pageFor('ben');
  logConsole(page, 'unread');
  await new Conversation(page, fillers[19].id).open();
  const started = Date.now();
  page.on('console', (m) => {
    if (/channel\.prewarm|evict_idle/.test(m.text()))
      console.log('SPAN at', Date.now() - started);
  });
  await leaveAlone(page, 120);
  await findConversations(page, '-edge');
  await expect(page.getByText(unread[1].name)).toBeVisible();
  await goOffline(page.context());
  const inside = await openFromList(page, unread[1]);
  await expectShown(inside, ['unread 1']);
  await page.getByText(unread[0].name).first().click();
  await expect(couldNotLoad(page)).toBeVisible({ timeout: 20_000 });
});

test('P-RECENT twenty recent', async ({ pageFor, ada, ben }) => {
  test.setTimeout(400_000);
  const recent = await named(
    ada,
    ben,
    Array.from(
      { length: 21 },
      (_, index) => `${index < 2 ? 'edge' : 'more'}${String(index).padStart(2, '0')}`
    )
  );
  for (const [index, channel] of recent.entries()) {
    await ada.post(channel.id, `recent ${index}`);
    await haveViewed('ben', channel.id);
  }
  const page = await pageFor('ben');
  logConsole(page, 'recent');
  await new Conversation(page, recent[20].id).open();
  await leaveAlone(page, 120);
  await findConversations(page, '-edge');
  await expect(page.getByText(recent[1].name)).toBeVisible();
  await goOffline(page.context());
  const inside = await openFromList(page, recent[1]);
  await expectShown(inside, ['recent 1']);
  await page.getByText(recent[0].name).first().click();
  await expect(couldNotLoad(page)).toBeVisible({ timeout: 20_000 });
});

test('P-FIFTY fifty messages', async ({ pageFor, ada, ben }) => {
  test.setTimeout(300_000);
  const elsewhere = await ada.createChannel({ members: [ben.person] });
  await ada.post(elsewhere.id, 'elsewhere');
  const long = await ada.createChannel({ members: [ben.person] });
  const texts = Array.from(
    { length: 55 },
    (_, index) => `long ${String(index + 1).padStart(2, '0')}`
  );
  await ada.postAll(long.id, texts);
  const page = await pageFor('ben');
  logConsole(page, 'fifty');
  await new Conversation(page, elsewhere.id).open();
  await findRow(page, long);
  await leaveAlone(page, 60);
  await goOffline(page.context());
  const view = await openFromList(page, long);
  await expect(view.message('long 55')).toBeVisible();
  const read = await view.readTo('long 06', 'back');
  console.log('FIFTYREAD', read.length, read[0]);
  for (let i = 0; i < 6; i += 1) await view.wheel(-600);
  await page.waitForTimeout(3000);
  console.log('FIFTYTOP', JSON.stringify((await view.texts()).slice(0, 4)));
  console.log(
    'FIFTYBODY',
    (await page.locator('[data-channel-scroll]').innerText()).slice(0, 300)
  );
});

test('P-EVICT thirty days', async ({ pageFor, ada, ben }) => {
  test.setTimeout(600_000);
  const old = await ada.createChannel({ members: [ben.person] });
  await ada.post(old.id, 'read long ago');
  const kept = await ada.createChannel({ members: [ben.person] });
  await ada.post(kept.id, 'read a month ago less a day');
  const fillers = await named(
    ada,
    ben,
    Array.from({ length: 20 }, (_, index) => `seen${index}`)
  );
  const page = await pageFor('ben');
  logConsole(page, 'evict');
  const now = Date.now();
  await new Conversation(page, old.id).open();
  await expectShown(new Conversation(page, old.id), ['read long ago']);
  await readAndReturn(page, old, fillers[0]);
  await page.clock.install({ time: now + 2 * DAY });
  await page.reload();
  const second = await readAndReturn(page, kept, fillers[0]);
  await expectShown(second, ['read a month ago less a day']);
  for (const filler of fillers) await haveViewed('ben', filler.id);
  await page.clock.setSystemTime(now + 31 * DAY);
  await page.goto(`/app/channel/${fillers[19].id}`);
  await new Conversation(page, fillers[19].id).shown();
  console.log('PAGEDATE', await page.evaluate(() => new Date().toISOString()));
  await leaveAlone(page, 150);
  await findRow(page, kept);
  await goOffline(page.context());
  const keptView = await openFromList(page, kept);
  await expectShown(keptView, ['read a month ago less a day']);
  await page.context().setOffline(false);
  await findRow(page, old);
  await page.context().setOffline(true);
  await page.getByText(old.name).first().click();
  await expect(couldNotLoad(page)).toBeVisible({ timeout: 20_000 });
});

test('P-RESET storage reset with queued writes', async ({
  pageFor,
  ada,
  ben,
}) => {
  test.setTimeout(300_000);
  const channel = await ada.createChannel({ members: [ben.person] });
  await ada.post(channel.id, 'one');
  const page = await pageFor('ben');
  logConsole(page, 'reset');
  const bens = new Conversation(page, channel.id);
  await bens.open();
  await expectShown(bens, ['one']);
  const unblock = await blockWrites(page.context());
  await bens.send('written before the reset');
  await expectShown(bens, ['one', 'written before the reset']);
  await expect(bens.list.getByText('Not sent yet')).toBeVisible({
    timeout: 20_000,
  });
  await page.route('**/kept-data-lost', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' })
  );
  await page.goto('/kept-data-lost');
  const removed = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    // @ts-expect-error: entries() is not in this lib version
    for await (const [name] of root.entries()) names.push(name);
    const results: string[] = [];
    for (const name of names) {
      try {
        await root.removeEntry(name, { recursive: true });
        results.push(`removed ${name}`);
      } catch (error) {
        results.push(`${name}: ${String(error)}`);
      }
    }
    return results;
  });
  console.log('RESETREMOVED', JSON.stringify(removed));
  await bens.open();
  await page.waitForTimeout(8000);
  console.log('RESETSHOWN1', JSON.stringify(await bens.texts()));
  console.log(
    'RESETBODY1',
    (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(-400)
  );
  await unblock();
  await page.waitForTimeout(30000);
  console.log('RESETSHOWN2', JSON.stringify(await bens.texts()));
  console.log('RESETSERVER', JSON.stringify(await serverChannel('ada', channel.id)));
});
