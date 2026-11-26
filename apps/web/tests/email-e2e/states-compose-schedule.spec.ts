// The new-email composer's primary button: its label for a chosen and for a
// changed send time, and what its tooltip says while a schedule is saved,
// changed or cancelled, and while a file too large to attach uploads to be
// shared as a link.

import { composeNew, loadAppSteadily, routeDraftId } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { notice } from './harness/send';
import {
  chooseFileToAttach,
  holdRequests,
  scheduleRequest,
  toolbarButtons,
  tooltip,
} from './harness/states-compose';
import {
  clock,
  openPicker,
  preset,
  scheduledClock,
  scheduledNotice,
} from './harness/ways-send';
import { saw } from './ledger/record';

test.beforeEach(({ page }) => loadAppSteadily(page));

// When this fails, choosing a send time leaves the button saying Send email
// (so the user cannot tell the email will wait), the button gives no reason
// while the schedule is being saved, changed or cancelled, or a new time for
// a scheduled email is not offered as an update. The composer's own labels,
// the same whatever the provider: Gmail only.
test('a send time turns Send into Schedule send, says why it waits while the schedule saves, changes and cancels, and offers Update schedule for a new time', async ({
  page,
  mailbox,
}) => {
  await composeNew(page, mailbox, {
    to: 'grace@example.com',
    subject: 'Later on',
    body: 'This can wait.',
  });
  await routeDraftId(page);
  await openPicker(page, clock(page));
  await preset(page, 'Tomorrow').click();
  const schedule = page.getByRole('button', {
    name: 'Schedule send',
    exact: true,
  });
  await expect(schedule).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Send email', exact: true })
  ).toHaveCount(0);
  saw('STC-049', 'F-142');

  const saving = await holdRequests(page, scheduleRequest('PUT'));
  await schedule.click();
  await saving.arrived;
  await page.mouse.move(0, 0);
  await expect(schedule).toBeDisabled();
  await schedule.hover({ force: true });
  await expect(tooltip(page, 'Scheduling email…')).toBeVisible();
  saw('STC-048');
  await page.mouse.move(0, 0);
  await saving.release();
  await expect(scheduledNotice(page)).toBeVisible();
  await expect(scheduledClock(page)).toBeVisible();

  await openPicker(page, scheduledClock(page));
  await preset(page, 'In 2 days').click();
  const update = page.getByRole('button', {
    name: 'Update schedule',
    exact: true,
  });
  await expect(update).toBeVisible();
  saw('STC-049', 'F-143');

  const updating = await holdRequests(page, scheduleRequest('PUT'));
  await update.click();
  await updating.arrived;
  await page.mouse.move(0, 0);
  await update.hover({ force: true });
  await expect(tooltip(page, 'Updating schedule…')).toBeVisible();
  await page.mouse.move(0, 0);
  await updating.release();
  await expect(scheduledClock(page)).toBeVisible();

  const cancelling = await holdRequests(page, scheduleRequest('DELETE'));
  await page.getByRole('button', { name: 'Cancel scheduled send' }).click();
  await cancelling.arrived;
  await page.mouse.move(0, 0);
  await page
    .getByRole('button', { name: 'Send email', exact: true })
    .hover({ force: true });
  await expect(tooltip(page, 'Cancelling schedule…')).toBeVisible();
  await page.mouse.move(0, 0);
  await cancelling.release();
  await expect(
    notice(page, 'Schedule cancelled. This email is editable again.')
  ).toBeVisible();
});

// When this fails, Send can be pressed, or is blocked without saying why,
// while a file too large to attach is still uploading to be shared as a
// link, or stays blocked once the upload ends. The upload goes to Macro,
// not to the provider: Gmail only.
test('Send waits with Uploading files to share… while a file too large to attach uploads', async ({
  page,
  mailbox,
}) => {
  await composeNew(page, mailbox, {
    to: 'grace@example.com',
    subject: 'Big survey',
    body: 'The survey follows as a link.',
  });
  await routeDraftId(page);
  const uploading = await holdRequests(
    page,
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/dss/documents'
  );
  await chooseFileToAttach(page, toolbarButtons(page).nth(1), {
    name: 'survey.txt',
    mimeType: 'text/plain',
    buffer: Buffer.alloc(18 * 1_000_000 + 1, 'a'),
  });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Share link' })
    .click();
  await uploading.arrived;
  const send = page.getByRole('button', { name: 'Send email', exact: true });
  await expect(send).toBeDisabled();
  await send.hover({ force: true });
  await expect(tooltip(page, 'Uploading files to share…')).toBeVisible();
  saw('STC-048');
  await page.mouse.move(0, 0);
  // This stack cannot store the document, so the upload ends in a failure;
  // either way its end lets Send go again.
  await uploading.release();
  await expect(send).toBeEnabled();
});
