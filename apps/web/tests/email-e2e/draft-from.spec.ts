import {
  body,
  composeNew,
  draftThreads,
  loadAppSteadily,
  routeDraftId,
  watchDraftSaves,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { header } from './harness/provider';
import { onlySentRaw, sentMessages } from './harness/send';

test.beforeEach(({ page }) => loadAppSteadily(page));

test.describe('changing From on a draft', () => {
  // Class composer-from-and-draft-identity: when this fails, a draft moved to
  // another of the user's inboxes is lost to the composer after a reload (it
  // opens empty, or on the copy the move replaced), is sent from the inbox it
  // was moved away from, or leaves a second draft behind.
  test('the moved draft survives a reload and is sent once, from the chosen address', async ({
    page,
    mailbox,
  }) => {
    const work = await mailbox.stack.link(
      mailbox.user,
      'GMAIL',
      'ada.work@example.com'
    );
    const saves = watchDraftSaves(page);
    await composeNew(page, mailbox, {
      to: 'bob@example.com',
      subject: 'Quarterly numbers',
      body: 'Numbers are in.',
    });
    const original = await routeDraftId(page);

    await page.getByText('ada@example.com').last().click();
    await page.getByText('ada.work@example.com <ada.work@example.com>').click();
    // The move gives the draft a new id in the other inbox; the route follows.
    await expect
      .poll(() =>
        new URL(page.url()).searchParams.get('s0.email-compose.draft')
      )
      .not.toBe(original);
    const moved = await routeDraftId(page);
    await body(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Sent from work.');
    await expect
      .poll(() =>
        saves.some(
          (save) =>
            save.html.includes('Sent from work.') && save.draftId === moved
        )
      )
      .toBe(true);
    await expect
      .poll(async () =>
        (await draftThreads(mailbox)).map((draft) => draft.linkId)
      )
      .toEqual([work.linkId]);

    await page.reload();
    await expect(body(page)).toContainText('Numbers are in. Sent from work.');
    await expect(page.getByText('ada.work@example.com').last()).toBeVisible();
    await page.getByRole('button', { name: 'Send email' }).click();

    const raw = await onlySentRaw(mailbox, work);
    expect(header(raw, 'From')).toContain('ada.work@example.com');
    expect(raw).toContain('Sent from work.');
    await expect.poll(() => draftThreads(mailbox)).toEqual([]);
    expect(await sentMessages(mailbox)).toEqual([]);
  });
});
