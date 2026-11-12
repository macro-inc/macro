import { expect, test } from '@playwright/test';
import {
  BOB,
  CAROL,
  deliver,
  draftsIn,
  openMailAs,
  subjectsIn,
  uniqueSubject,
} from './gmail';

test('new Gmail mail appears in the inbox without a reload', async ({
  page,
  request,
}) => {
  await openMailAs(page, BOB);
  const subject = uniqueSubject('Live delivery');

  await deliver(request, BOB, {
    from: 'Dana <dana@example.com>',
    subject,
    text: 'Arrived while the inbox was open.',
  });

  await expect(
    page.getByRole('row', { name: new RegExp(subject) })
  ).toBeVisible({
    timeout: 60_000,
  });
});

test('a reply reaches its recipient and leaves no draft behind', async ({
  page,
  request,
}) => {
  await openMailAs(page, BOB);
  const subject = uniqueSubject('Lunch');
  await deliver(request, BOB, {
    from: `Carol <${CAROL.email}>`,
    subject,
    text: 'Noon on Friday?',
  });

  await page
    .getByRole('row', { name: new RegExp(subject) })
    .click({ timeout: 60_000 });
  await page.getByRole('button', { name: /Reply\.\.\./ }).click();
  await page.getByRole('textbox', { name: /^Reply/ }).fill('Friday works.');
  await page.getByRole('button', { name: 'Send email' }).click();

  await expect
    .poll(
      async () => (await subjectsIn(request, CAROL)).includes(`Re: ${subject}`),
      {
        timeout: 60_000,
      }
    )
    .toBe(true);
  expect(await draftsIn(request, BOB)).toEqual([]);
  await page.goto('component/mail');
  await page
    .getByRole('navigation', { name: 'Email tabs' })
    .getByRole('button', { name: 'Drafts' })
    .click();
  await expect(page.getByText('No drafts')).toBeVisible({ timeout: 30_000 });
});

test('an email marked done stays hidden when new mail arrives', async ({
  page,
  request,
}) => {
  await openMailAs(page, BOB);
  const done = uniqueSubject('Receipt');
  await deliver(request, BOB, {
    from: 'Shop <shop@example.com>',
    subject: done,
    text: 'Thanks for your order.',
  });
  const doneRow = page.getByRole('row', { name: new RegExp(done) });
  await doneRow.click({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Mark done' }).click();
  await expect(doneRow).toHaveCount(0);
  await page.goto('component/mail');

  const later = uniqueSubject('Later');
  await deliver(request, BOB, {
    from: 'Dana <dana@example.com>',
    subject: later,
    text: 'Another one.',
  });

  await expect(page.getByRole('row', { name: new RegExp(later) })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('row', { name: new RegExp(done) })).toHaveCount(
    0
  );
});
