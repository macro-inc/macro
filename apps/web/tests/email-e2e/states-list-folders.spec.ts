// What Spam and Trash offer to bring mail back: a row's own button, named
// "Not spam" in Spam and "Restore" in Trash, and the selection toolbar's
// Restore, which waits while a restore is on its way. Each for a Gmail and
// an Outlook inbox.

import { graphqlOperation, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { deliverToSpam, syncedInView } from './harness/journeys';
import {
  catchUpFinished,
  focusRow,
  rowIds,
  sentOperations,
} from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import {
  deliverToTrash,
  holdOperation,
  refuseOperation,
  sidebarTab,
  toolbarButton,
} from './harness/states-list';
import { GRACE } from './harness/ways-list1';
import { listShows, row, rowCheckbox } from './harness/ways-list2';
import { held } from './harness/ways-thread';
import { did, saw } from './ledger/record';

// A disconnected trash must leave All Mail, reach the provider on reconnect,
// and return to the mounted list even if Undo's committed reply drops its row.
test('replays a disconnected trash and restores All Mail without a Soup read', async ({
  page,
  mailbox,
}) => {
  test.setTimeout(120_000);
  await mailbox.deliver({ from: GRACE, subject: 'Old invoice', text: 'Paid.' });
  const thread = (await mailbox.synced('Old invoice')).id;
  await mailbox.open();
  await sidebarTab(page, 'All mail');
  await listShows(page, [thread]);
  await expect
    .poll(() => catchUpFinished(page), { timeout: 60_000 })
    .toBe(true);
  const sent = sentOperations(page);
  const stateWrites = () =>
    sent.filter(({ name }) => name === 'SetEmailThreadFolderStates');
  const isTrashed = async () =>
    (await mailbox.providerMessages()).some((message) =>
      message.labels.includes('TRASH')
    );

  await focusRow(page, thread);
  await page.context().setOffline(true);
  let attemptedOffline = 0;
  try {
    await page.keyboard.press('Shift+Digit3');
    await expect.poll(() => rowIds(page)).not.toContain(thread);
    expect(await isTrashed()).toBe(false);
    attemptedOffline = stateWrites().length;
  } finally {
    await page.context().setOffline(false);
  }
  await expect.poll(isTrashed).toBe(true);
  expect(
    stateWrites()
      .slice(attemptedOffline)
      .map(({ variables }) => variables)
  ).toContainEqual({
    input: { threadIds: [thread], field: 'TRASHED', value: true },
  });

  const moved = notice(page, 'Moved to Trash');
  await moved.hover();
  // Route.fetch uses the runner's connection, so inject the failure only
  // after Undo has been admitted offline and the provider is still in Trash.
  let injectMissingEffect = false;
  await page.route(/\/graphql(\?|$)/, async (route) => {
    const request = route.request();
    if (
      !injectMissingEffect ||
      graphqlOperation(request) !== 'SetEmailThreadFolderStates' ||
      !request.postData()?.includes('"value":false')
    )
      return route.fallback();

    const response = await route.fetch();
    const payload = await response.json();
    expect(payload.data.setEmailThreadFolderStates).toMatchObject([
      { threadId: thread, error: null },
    ]);
    payload.data.setEmailThreadFolderStates[0].effect = null;
    await route.fulfill({
      response,
      json: {
        ...payload,
        errors: [
          {
            message: 'Preview projection unavailable',
            path: ['setEmailThreadFolderStates', 0, 'effect'],
          },
        ],
      },
    });
  });
  const beforeUndo = sent.length;
  await page.context().setOffline(true);
  try {
    await moved.getByRole('button', { name: 'Undo' }).click();
    await expect(notice(page, 'Restored from Trash')).toBeVisible();
    expect(await isTrashed()).toBe(true);
    injectMissingEffect = true;
  } finally {
    await page.context().setOffline(false);
  }
  await listShows(page, [thread]);
  await expect.poll(isTrashed).toBe(false);
  expect(
    sent
      .slice(beforeUndo)
      .filter(({ name }) => name === 'RecoverEmailThreadFolderRow')
      .map(({ variables }) => variables)
  ).toEqual([{ threadId: thread }]);
  expect(sent.slice(beforeUndo).filter(({ name }) => name === 'Soup')).toEqual(
    []
  );
});

// Replay must acknowledge accepted and rejected writes independently and
// preserve a pre-existing Trash membership.
test('settles each thread of a partially rejected offline trash independently', async ({
  page,
  mailbox,
}) => {
  test.setTimeout(120_000);
  await mailbox.deliver({ from: GRACE, subject: 'Agenda', text: 'Ready.' });
  await mailbox.deliver({ from: GRACE, subject: 'Minutes', text: 'Ready.' });
  await deliverToTrash(mailbox, {
    from: GRACE,
    subject: 'Discarded notes',
    text: 'Old copy.',
  });
  const accepted = (await mailbox.synced('Agenda')).id;
  const rejected = (await mailbox.synced('Minutes')).id;
  const alreadyTrashed = await syncedInView(
    mailbox,
    'trash',
    'Discarded notes'
  );
  const missing = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  await mailbox.open();
  await sidebarTab(page, 'All mail');
  await listShows(page, [accepted, rejected]);
  await expect
    .poll(() => catchUpFinished(page), { timeout: 60_000 })
    .toBe(true);
  for (const id of [accepted, rejected])
    await (await rowCheckbox(page, id)).click();
  await expect(page.getByText('2 selected')).toBeVisible();

  let replay = false;
  await page.route(/\/graphql(\?|$)/, async (route) => {
    const request = route.request();
    if (graphqlOperation(request) !== 'SetEmailThreadFolderStates')
      return route.fallback();
    const requestBody = request.postDataJSON();
    const input = requestBody.variables.input;
    if (input.field !== 'TRASHED' || !input.value) return route.fallback();
    if (!replay) return route.abort('internetdisconnected');
    expect(input.threadIds).toEqual(
      expect.arrayContaining([accepted, rejected])
    );
    await route.fulfill({
      response: await route.fetch({
        postData: {
          ...requestBody,
          variables: {
            input: { ...input, threadIds: [accepted, alreadyTrashed, missing] },
          },
        },
      }),
    });
  });
  const settled = page.waitForResponse(
    (response) =>
      replay &&
      graphqlOperation(response.request()) === 'SetEmailThreadFolderStates' &&
      response.request().postData()?.includes('"value":true') === true
  );
  const sent = sentOperations(page);
  await page.context().setOffline(true);
  let beforeReplay = 0;
  try {
    const interrupted = page.waitForEvent(
      'requestfailed',
      (request) => graphqlOperation(request) === 'SetEmailThreadFolderStates'
    );
    await page.keyboard.press('Shift+Digit3');
    await listShows(page, []);
    // Wait for the first send to fail offline. The optimistic row removal can
    // happen before admission, while the live caller could still compensate.
    await interrupted;
    expect((await held(mailbox, 'Agenda'))?.labels).not.toContain('TRASH');
    beforeReplay = sent.length;
    replay = true;
  } finally {
    await page.context().setOffline(false);
  }

  expect(await (await settled).json()).toMatchObject({
    data: {
      setEmailThreadFolderStates: [
        {
          threadId: accepted,
          error: null,
          effect: { id: accepted, mailAllPreview: null },
        },
        {
          threadId: alreadyTrashed,
          error: null,
          effect: { id: alreadyTrashed, mailAllPreview: null },
        },
        {
          threadId: missing,
          error: expect.any(String),
          effect: null,
        },
      ],
    },
  });
  await listShows(page, [rejected]);
  await expect
    .poll(async () => (await held(mailbox, 'Agenda'))?.labels)
    .toContain('TRASH');
  expect((await held(mailbox, 'Discarded notes'))?.labels).toContain('TRASH');
  expect(
    sent
      .slice(beforeReplay)
      .filter(({ name }) => name === 'SetEmailThreadFolderStates')
  ).toHaveLength(1);
  expect(sent.filter(({ name }) => name === 'Soup')).toEqual([]);
});

for (const provider of PROVIDERS) {
  test.describe(`bringing mail back from Spam and Trash of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a row in Spam offers no "Not spam" or a row in Trash
    // no "Restore", the selection toolbar in Trash has no Restore, or it
    // can be pressed again while a restore is on its way (or stays
    // disabled, or drops the selection, once that restore failed).
    test('rows offer Not spam and Restore, and the toolbar Restore waits for the restore', async ({
      page,
      mailbox,
    }) => {
      await deliverToSpam(mailbox, {
        from: GRACE,
        subject: 'Team photos',
        text: 'From the offsite.',
      });
      for (const subject of ['Old invoice', 'Older invoice'])
        await deliverToTrash(mailbox, { from: GRACE, subject, text: 'Paid.' });
      const spam = await syncedInView(mailbox, 'spam', 'Team photos');
      const trashed = [
        await syncedInView(mailbox, 'trash', 'Old invoice'),
        await syncedInView(mailbox, 'trash', 'Older invoice'),
      ];
      await refuseOperation(page, 'SetEmailThreadFolderStates');
      const held = await holdOperation(page, 'SetEmailThreadFolderStates');

      await mailbox.open();
      await sidebarTab(page, 'Spam');
      await listShows(page, [spam]);
      await row(page, spam).hover();
      await expect(
        row(page, spam).getByRole('button', { name: 'Not spam', exact: true })
      ).toBeVisible();
      saw('STL-038', 'F-078');

      await sidebarTab(page, 'Trash');
      await listShows(page, trashed);
      await row(page, trashed[0]).hover();
      await expect(
        row(page, trashed[0]).getByRole('button', {
          name: 'Restore',
          exact: true,
        })
      ).toBeVisible();
      saw('STL-038', 'F-076');

      for (const id of trashed) await (await rowCheckbox(page, id)).click();
      await expect(page.getByText('2 selected')).toBeVisible();
      const restore = toolbarButton(page, 'Restore');
      await expect(restore).toBeEnabled();
      await restore.click();
      did('AL-406', 'F-076');
      await expect.poll(held.count).toBeGreaterThan(0);
      await expect(restore).toBeDisabled();
      saw('STL-402');

      await held.release();
      await expect(restore).toBeEnabled();
      await expect(page.getByText('2 selected')).toBeVisible();
      await listShows(page, trashed);
    });
  });
}
