import { expect, type Page, test } from '@playwright/test';
import { differenceInCalendarDays } from 'date-fns';

const path = '/src/features/email-marketing/browser-test/marketing.html';

type Draft = {
  id: string;
  email: string;
  subject: string;
  body: string;
  threadId: string;
  replyingToId?: string;
  sendAt?: string;
};
const outbox = (page: Page): Promise<Draft[]> =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem('marketing-test-outbox') ?? '[]')
  );
const stored = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('marketing-test')!));
const nav = (page: Page) =>
  page.getByRole('navigation', { name: 'Email Marketing navigation' });
/** Confirmations are toasts, which stack: check the newest. */
const notice = (page: Page, text: string | RegExp) =>
  expect(
    page.getByRole('status').filter({ hasText: text }).last()
  ).toBeVisible();

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('button', { name: label }).click();
  // The listbox portals outside an open dialog, which hides it from role queries.
  await page.locator('[role="option"]').filter({ hasText: option }).click();
}
/**
 * Pick one of a Tabs control's options as a person does, by its segment
 * (icon-only tabs have no visible text; the native radio is tiny).
 */
async function pick(page: Page, group: string, option: string) {
  const radio = page
    .getByRole('radiogroup', { name: group })
    .getByRole('radio', { name: new RegExp(`^${option}`) });
  const label = await radio.getAttribute('aria-labelledby');
  await page.locator(`[id="${label}"]`).click();
  await expect(radio).toBeChecked();
}
async function openCampaign(page: Page, name: string) {
  await page.getByRole('button', { name: new RegExp(name) }).click();
}
async function activateAndEnroll(page: Page, emails: string[]) {
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  await notice(page, 'Campaign is active');
  await page.getByRole('button', { name: 'Enroll contacts' }).click();
  const dialog = page.getByRole('dialog');
  // Click the labels, as a person does; the styled control covers the input.
  for (const email of emails)
    await dialog.getByText(email, { exact: true }).click();
  await dialog.getByText(/permission to email/).click();
  await dialog
    .getByRole('button', {
      name: `Enroll ${emails.length} contact${emails.length === 1 ? '' : 's'}`,
    })
    .click();
  await notice(page, /enrolled\. Emails scheduled/);
}

// Every scenario must finish without uncaught page errors.
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

test('creates, personalizes, threads, enrolls, cross-references CRM, pauses, resumes, and stops', async ({
  page,
}) => {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(
    nav(page).getByRole('button', { name: /Campaigns/ })
  ).toBeVisible();
  await page.getByRole('button', { name: 'New campaign' }).first().click();
  const create = page.getByRole('dialog');
  await create.getByLabel('Campaign name').fill('A warm welcome');
  await create.getByRole('button', { name: 'Create campaign' }).click();
  await notice(page, 'Campaign created');
  // The welcome template: a first email and a reply in its thread.
  await expect(page.getByText('Re: Welcome, {{firstName}}')).toBeVisible();
  await page
    .getByLabel('Email 1 subject')
    .fill('Welcome to Macro, {{firstName}}');
  await expect(
    page.getByText('Re: Welcome to Macro, {{firstName}}')
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add email' }).click();
  await page.getByLabel('Email 3 delay in days').fill('3');
  await page
    .getByLabel('Email 3 message')
    .fill('Hi {{firstName}},\n\nAnything we can help with?');
  // Email 3 starts its own thread.
  const reply = page
    .getByRole('article', { name: 'Email 3' })
    .getByRole('checkbox', { name: /reply in the same thread/ });
  await expect(reply).toBeChecked();
  await page
    .getByRole('article', { name: 'Email 3' })
    .getByText(/reply in the same thread/)
    .click();
  await expect(reply).not.toBeChecked();
  await page.getByLabel('Email 3 subject').fill('One more idea');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await notice(page, 'Campaign saved');

  await page
    .getByRole('article', { name: 'Email 2' })
    .getByRole('button', { name: 'Preview' })
    .click();
  const preview = page.getByRole('dialog');
  await expect(preview).toContainText('Re: Welcome to Macro, Alex');
  await choose(page, 'Preview contact', 'Jamie Chen');
  await expect(preview).toContainText('Re: Welcome to Macro, Jamie');
  await expect(preview).toContainText('reply "unsubscribe"');
  await preview.getByRole('button', { name: 'Close' }).click();

  await activateAndEnroll(page, ['alex@example.com', 'jamie@example.com']);
  await expect(page.getByLabel('Email 1 subject')).toBeDisabled();
  const drafts = await outbox(page);
  expect(drafts).toHaveLength(6);
  const alex = drafts.filter((draft) => draft.email === 'alex@example.com');
  expect(alex.map((draft) => draft.subject)).toEqual([
    'Welcome to Macro, Alex',
    'Re: Welcome to Macro, Alex',
    'One more idea',
  ]);
  // The follow-up replies in the first email's thread; email 3 is a new thread.
  expect(alex[1].replyingToId).toBe(alex[0].id);
  expect(alex[1].threadId).toBe(alex[0].threadId);
  expect(alex[2].replyingToId).toBeUndefined();
  expect(alex[2].threadId).not.toBe(alex[0].threadId);
  // Delays are calendar days at the same local time, even across a DST change.
  const sendAt = alex.map((draft) => new Date(draft.sendAt!));
  expect(differenceInCalendarDays(sendAt[1], sendAt[0])).toBe(2);
  expect(differenceInCalendarDays(sendAt[2], sendAt[1])).toBe(3);
  for (const time of sendAt)
    expect(time.getHours() * 60 + time.getMinutes()).toBe(
      sendAt[0].getHours() * 60 + sendAt[0].getMinutes()
    );

  await pick(page, 'Campaign views', 'Enrollments');
  const alexCard = page.getByRole('article', { name: 'Alex Morgan' });
  await expect(alexCard).toContainText('Re: Welcome to Macro, Alex');
  await alexCard.getByRole('button', { name: 'Alex Morgan' }).click();
  await expect(page.getByRole('dialog')).toContainText('A warm welcome');
  await page.getByRole('button', { name: 'Open CRM contact' }).click();
  await expect(
    page.getByRole('region', { name: 'Email Marketing enrollments' })
  ).toContainText('A warm welcome');
  await page.getByRole('button', { name: 'Back to Email Marketing' }).click();

  await openCampaign(page, 'A warm welcome');
  await pick(page, 'Campaign views', 'Enrollments');
  await alexCard.getByRole('button', { name: 'Pause', exact: true }).click();
  await notice(page, 'Enrollment paused');
  await expect.poll(async () => (await outbox(page)).length).toBe(3);
  await alexCard.getByRole('button', { name: 'Resume' }).click();
  await notice(page, 'Upcoming emails rescheduled');
  await expect.poll(async () => (await outbox(page)).length).toBe(6);
  await alexCard.getByRole('button', { name: 'Stop', exact: true }).click();
  await notice(page, 'Enrollment stopped');
  await expect.poll(async () => (await outbox(page)).length).toBe(3);
  await page.getByRole('button', { name: 'Pause campaign' }).click();
  await notice(page, 'Campaign paused');
  await expect.poll(async () => (await outbox(page)).length).toBe(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openCampaign(page, 'A warm welcome');
  await expect(page.getByLabel('Email 1 subject')).toHaveValue(
    'Welcome to Macro, {{firstName}}'
  );
  await pick(page, 'Campaign views', 'Enrollments');
  await expect(alexCard.getByText('Stopped', { exact: true })).toBeVisible();
  await nav(page)
    .getByRole('button', { name: /Delivery/ })
    .click();
  await expect(page.getByText('hello@macro.example')).toBeVisible();
});

test('unsubscribing stops a contact in every campaign and blocks enrolling them again', async ({
  page,
}) => {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await openCampaign(page, 'Customer onboarding');
  await activateAndEnroll(page, ['alex@example.com', 'sam@example.com']);
  await page.getByRole('button', { name: 'All campaigns' }).click();
  await openCampaign(page, 'A friendly check-in');
  await activateAndEnroll(page, ['alex@example.com']);
  expect(await outbox(page)).toHaveLength(5);

  // From an enrollment: every campaign stops emailing Alex.
  await pick(page, 'Campaign views', 'Enrollments');
  await page
    .getByRole('article', { name: 'Alex Morgan' })
    .getByRole('button', { name: 'Mark unsubscribed' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Mark unsubscribed' })
    .click();
  await notice(page, 'alex@example.com is unsubscribed');
  expect((await outbox(page)).map((draft) => draft.email)).toEqual([
    'sam@example.com',
    'sam@example.com',
  ]);
  const data = await stored(page);
  expect(
    data.enrollments
      .filter(
        (entry: { contact: { email: string } }) =>
          entry.contact.email === 'alex@example.com'
      )
      .map((entry: { status: string }) => entry.status)
  ).toEqual(['stopped', 'stopped']);

  // From the contact: Sam is unsubscribed too.
  await nav(page)
    .getByRole('button', { name: /Contacts/ })
    .click();
  await page.getByRole('button', { name: /Sam Rivera/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Mark unsubscribed' })
    .click();
  await page
    .getByRole('dialog')
    .filter({ hasText: 'Unsubscribe sam@example.com?' })
    .getByRole('button', { name: 'Mark unsubscribed' })
    .click();
  await expect(page.getByRole('dialog')).toContainText(
    'Unsubscribed from every campaign.'
  );
  await page.keyboard.press('Escape');
  await notice(page, 'sam@example.com is unsubscribed');
  expect(await outbox(page)).toEqual([]);

  // A campaign Sam was never in still can't enroll Sam.
  await nav(page)
    .getByRole('button', { name: /Campaigns/ })
    .click();
  await openCampaign(page, 'A friendly check-in');
  await page.getByRole('button', { name: 'Enroll contacts' }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('checkbox', { name: /sam@example\.com/ })
  ).toBeDisabled();
  await expect(
    dialog.getByRole('checkbox', { name: /sam@example\.com/ })
  ).toHaveAccessibleName(/Unsubscribed/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await nav(page)
    .getByRole('button', { name: /Unsubscribed/ })
    .click();
  const list = page.getByRole('list', { name: 'Unsubscribed' });
  await expect(list).toContainText('alex@example.com');
  await expect(list).toContainText('sam@example.com');
});

test('deleting a campaign cancels its upcoming emails and removes its records', async ({
  page,
}) => {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await openCampaign(page, 'Customer onboarding');
  await activateAndEnroll(page, ['alex@example.com', 'jamie@example.com']);
  expect(await outbox(page)).toHaveLength(4);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await notice(page, 'Deleted Customer onboarding');
  expect(await outbox(page)).toEqual([]);
  const data = await stored(page);
  expect(data.campaigns.map((item: { name: string }) => item.name)).toEqual([
    'A friendly check-in',
  ]);
  expect(data.enrollments).toEqual([]);
  await expect(
    page.getByRole('button', { name: /Customer onboarding/ })
  ).toHaveCount(0);
});

test('a failed send is flagged on the next visit in the list, the enrollment, and CRM', async ({
  page,
}) => {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await openCampaign(page, 'Customer onboarding');
  await activateAndEnroll(page, ['alex@example.com']);
  const [first] = await outbox(page);
  // Gmail rejected the first email while the workspace was closed.
  await page.evaluate((id) => {
    localStorage.setItem('marketing-test-failed', JSON.stringify([id]));
  }, first.id);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('button', { name: /Customer onboarding/ })
  ).toContainText('1 needs attention');
  await expect(
    nav(page).getByRole('button', { name: /Campaigns/ })
  ).toContainText('1');
  await openCampaign(page, 'Customer onboarding');
  await pick(page, 'Campaign views', 'Enrollments');
  const card = page.getByRole('article', { name: 'Alex Morgan' });
  await expect(card.getByText('Send failed').first()).toBeVisible();
  await expect(card).toContainText('Gmail rejected this email');
  await card.getByRole('button', { name: 'Open email' }).first().click();
  await expect(page.getByTestId('opened-thread')).toHaveText(first.threadId);
  await page.getByRole('button', { name: 'Back to Email Marketing' }).click();
  await openCampaign(page, 'Customer onboarding');
  await pick(page, 'Campaign views', 'Enrollments');
  await card.getByRole('button', { name: 'Alex Morgan' }).click();
  await page.getByRole('button', { name: 'Open CRM contact' }).click();
  await expect(
    page.getByRole('region', { name: 'Email Marketing enrollments' })
  ).toContainText('Send failed');
});

test('emails whose records were lost are flagged and can be canceled', async ({
  page,
}) => {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await openCampaign(page, 'Customer onboarding');
  await activateAndEnroll(page, ['alex@example.com']);
  expect(await outbox(page)).toHaveLength(2);
  // The records go (the database was trashed, or the table deleted), the
  // scheduled emails stay.
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('marketing-test')!);
    data.enrollments = [];
    localStorage.setItem('marketing-test', JSON.stringify(data));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByText(/2 scheduled sequence emails have no campaign record/)
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel them' }).click();
  await notice(page, 'Untracked sequence emails were canceled');
  expect(await outbox(page)).toEqual([]);
  await expect(page.getByText(/have no campaign record/)).toHaveCount(0);
});

test('a stale tab cannot overwrite a campaign another tab changed', async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await other.goto(path, { waitUntil: 'domcontentloaded' });
  for (const client of [page, other])
    await openCampaign(client, 'Customer onboarding');
  await other.getByLabel('Campaign name').fill('Renamed in another tab');
  await other.getByRole('button', { name: 'Save draft' }).click();
  await notice(other, 'Campaign saved');
  await page.getByLabel('Campaign name').fill('My stale edit');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('alert')).toContainText('This campaign changed');
  await expect(
    page.getByText(/changed in another tab or device/)
  ).toBeVisible();
  await page.getByRole('button', { name: 'Discard my changes' }).click();
  await expect(page.getByLabel('Campaign name')).toHaveValue(
    'Renamed in another tab'
  );
  const data = await stored(page);
  expect(
    data.campaigns.find((item: { id: string }) => item.id === 'example-welcome')
      .name
  ).toBe('Renamed in another tab');
});

test('blocks duplicate enrollment and disables writes on a read-only database', async ({
  page,
}) => {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await openCampaign(page, 'Customer onboarding');
  await activateAndEnroll(page, ['alex@example.com']);
  await page.getByRole('button', { name: 'Enroll contacts' }).click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('checkbox', { name: /alex@example\.com/ })
  ).toBeDisabled();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel' })
    .click();
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('marketing-test')!);
    data.writable = false;
    localStorage.setItem('marketing-test', JSON.stringify(data));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('button', { name: 'New campaign' }).first()
  ).toBeDisabled();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('navigates sections with tabs and fits the screen', async ({ page }) => {
    await page.goto(`${path}?theme=dark`, { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('radiogroup', { name: 'Email Marketing navigation' })
    ).toBeVisible();
    await openCampaign(page, 'Customer onboarding');
    await expect(page.getByLabel('Email 1 subject')).toBeVisible();
    await page.getByRole('button', { name: 'All campaigns' }).click();
    await pick(page, 'Email Marketing navigation', 'Contacts');
    await expect(page.getByText('jamie@example.com')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
  });
});
