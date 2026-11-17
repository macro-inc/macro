import type { Page } from '@playwright/test';
import { type Api, unique } from './harness/api';
import { conversationRow } from './harness/channel';
import {
  couldNotLoad,
  expectShown,
  findRow,
  leaveAlone,
  type Named,
  openFromList,
  readAndReturn,
} from './harness/device';
import { expect, LOCAL_SYNC_BUILD, test } from './harness/fixtures';
import { Conversation } from './harness/messages';
import { goOffline, goOnline } from './harness/network';
import { findConversations, haveViewed } from './harness/sidebar';

// A device left alone fetches the channels its person is likely to open
// next, so that they open without a connection too.
test.skip(
  !LOCAL_SYNC_BUILD,
  'channels are kept on the device only with the flag'
);

// If this fails, a channel with unread messages that the person has never
// opened on this device needs a connection the first time they open it.
test('PRE-01 an unread channel never opened on this device opens with no connection once the app has been left alone', async ({
  pageFor,
  ada,
  ben,
}) => {
  test.setTimeout(120_000);
  const elsewhere = await ada.createChannel({ members: [ben.person] });
  await ada.post(elsewhere.id, 'elsewhere');
  const unread = await ada.createChannel({ members: [ben.person] });
  await ada.postAll(unread.id, ['unread one', 'unread two', 'unread three']);
  const page = await pageFor('ben');
  await new Conversation(page, elsewhere.id).open();
  await findRow(page, unread);

  await leaveAlone(page, 25);
  await goOffline(page.context());
  const view = await openFromList(page, unread);

  await expectShown(view, ['unread one', 'unread two', 'unread three']);
});

const DAY = 86_400_000;

/**
 * As many channels of Ada's and Ben's, made one after another. The first two
 * are found together by their names' common start: the one just outside a limit and the one
 * just inside it.
 */
async function row(ada: Api, ben: Api, count: number): Promise<Named[]> {
  const stem = unique('pre');
  const made: Named[] = [];
  for (let index = 0; index < count; index += 1) {
    const label = `${index < 2 ? 'edge' : 'more'}${String(index).padStart(2, '0')}`;
    made.push(
      await ada.createChannel({
        name: `${stem}-${label}`,
        members: [ben.person],
      })
    );
  }
  return made;
}

/**
 * With no connection, the second channel of the row opens with its message
 * and the first cannot be loaded.
 */
async function expectOnlySecondHeld(
  page: Page,
  channels: Named[],
  texts: string[]
): Promise<void> {
  await findConversations(page, channels[0].name.slice(0, -2));
  await expect(conversationRow(page, channels[0].name)).toBeVisible();
  await expect(conversationRow(page, channels[1].name)).toBeVisible();
  await goOffline(page.context());
  const inside = await openFromList(page, channels[1]);
  await expectShown(inside, [texts[1]]);
  await conversationRow(page, channels[0].name).click();
  await expect(couldNotLoad(page)).toBeVisible({ timeout: 20_000 });
}

// If this fails, a device fetches more unread channels than the forty it
// is meant to, or fewer: the fortieth does not open with no connection.
test('PRE-02 a device left alone fetches the forty unread channels written in last, and not the forty-first', async ({
  pageFor,
  ada,
  ben,
}) => {
  test.setTimeout(300_000);
  // The first channel is kept out of the twenty looked at last, the other
  // way a device comes to fetch a channel.
  const looked = await row(ada, ben, 20);
  const unread = await row(ada, ben, 41);
  await haveViewed('ben', unread[0].id);
  for (const channel of looked) await haveViewed('ben', channel.id);
  const texts = unread.map((_, index) => `unread ${index}`);
  for (const [index, channel] of unread.entries()) {
    await ada.post(channel.id, texts[index]);
  }
  const page = await pageFor('ben');
  await new Conversation(page, looked[19].id).open();

  await leaveAlone(page, 120);

  await expectOnlySecondHeld(page, unread, texts);
});

// If this fails, a device fetches more of the channels a person looked at
// than the twenty it is meant to, or fewer.
test('PRE-03 a device left alone fetches the twenty channels its person looked at last, and not the twenty-first', async ({
  pageFor,
  ada,
  ben,
}) => {
  test.setTimeout(300_000);
  const looked = await row(ada, ben, 21);
  const texts = looked.map((_, index) => `looked at ${index}`);
  // Ben's own messages leave nothing unread, which a device fetches too.
  for (const [index, channel] of looked.entries()) {
    await ben.post(channel.id, texts[index]);
  }
  for (const channel of looked) await haveViewed('ben', channel.id);
  const page = await pageFor('ben');
  await new Conversation(page, looked[20].id).open();

  await leaveAlone(page, 120);

  await expectOnlySecondHeld(page, looked, texts);
});

// If this fails, a fetched channel opens with fewer than its latest fifty
// messages with no connection, or the older ones never come.
test('PRE-04 a fetched channel opens with its latest fifty messages with no connection, and the older ones come when the connection is back', async ({
  pageFor,
  ada,
  ben,
}) => {
  test.setTimeout(240_000);
  const elsewhere = await ada.createChannel({ members: [ben.person] });
  await ada.post(elsewhere.id, 'elsewhere');
  const long = await ada.createChannel({ members: [ben.person] });
  const texts = Array.from(
    { length: 55 },
    (_, index) => `long ${String(index + 1).padStart(2, '0')}`
  );
  await ada.postAll(long.id, texts);
  const page = await pageFor('ben');
  await new Conversation(page, elsewhere.id).open();
  await findRow(page, long);

  await leaveAlone(page, 60);
  await goOffline(page.context());
  const view = await openFromList(page, long);

  await expect(view.message('long 55')).toBeVisible();
  expect(await view.readTo('long 06', 'back')).toEqual(texts.slice(5));
  for (let wheel = 0; wheel < 3; wheel += 1) await view.wheel(-2000);
  expect((await view.texts())[0]).toBe('long 06');
  await expect(view.message('long 05')).toHaveCount(0);
  await goOnline(page.context());
  const older = await view.readTo('long 01', 'back');
  expect(older.slice(0, 6)).toEqual(texts.slice(0, 6));
});

// If this fails, channels a person stopped opening stay on the device for
// good, or a channel they opened within the month is dropped.
test('PRE-05 a channel not opened for thirty days is no longer on the device, and one opened two days later still is', async ({
  pageFor,
  ada,
  ben,
}) => {
  test.setTimeout(600_000);
  const old = await ada.createChannel({ members: [ben.person] });
  // Ben's own messages: an unread channel is one a device fetches again.
  await ben.post(old.id, 'opened thirty-one days ago');
  const recent = await ada.createChannel({ members: [ben.person] });
  await ben.post(recent.id, 'opened twenty-nine days ago');
  const looked = await row(ada, ben, 20);
  const page = await pageFor('ben');
  const today = Date.now();
  const first = await readAndReturn(page, old, looked[0]);
  await expectShown(first, ['opened thirty-one days ago']);
  // Each channel is left before the clock moves: a page opening on it
  // again would count as opening it on the later day.
  await findRow(page, looked[0]);
  await openFromList(page, looked[0]);
  // Twenty channels looked at since: a device fetches the twenty its person
  // looked at last, and fetching one again counts as opening it that day.
  for (const channel of looked) await haveViewed('ben', channel.id);
  // The device's clock is moved on: the suite cannot wait a month.
  await page.clock.install({ time: today + 2 * DAY });
  await page.reload();
  const second = await readAndReturn(page, recent, looked[0]);
  await expectShown(second, ['opened twenty-nine days ago']);
  // And again, now that the second channel has been looked at.
  await findRow(page, looked[0]);
  await openFromList(page, looked[0]);
  for (const channel of looked) await haveViewed('ben', channel.id);
  await page.clock.setSystemTime(today + 31 * DAY);
  await new Conversation(page, looked[19].id).open();

  await leaveAlone(page, 300);

  await findRow(page, recent);
  await goOffline(page.context());
  const kept = await openFromList(page, recent);
  await expectShown(kept, ['opened twenty-nine days ago']);
  await goOnline(page.context());
  await findRow(page, old);
  await goOffline(page.context());
  await conversationRow(page, old.name).click();
  await expect(couldNotLoad(page)).toBeVisible({ timeout: 20_000 });
});
