import {
  expectShown,
  findRow,
  leaveAlone,
  openFromList,
} from './harness/device';
import { SOUP_BUILD, test } from './harness/fixtures';
import { Conversation } from './harness/messages';
import { goOffline } from './harness/network';

// A device left alone fetches the channels its person is likely to open
// next, so that they open without a connection too.
test.skip(!SOUP_BUILD, 'channels are kept on the device only with the flag');

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
