import { expect, test } from '@playwright/test';

test('starts blank and preserves the editor, focus, caret and undo as calendar fields appear', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await expect(input).toHaveValue('');
  await expect(input).not.toHaveAttribute('placeholder');
  await input.evaluate((element) => {
    element.setAttribute('data-original', 'true');
  });
  await input.pressSequentially('Call John at 3pm tomorrow');
  await expect(
    page.getByRole('button', { name: 'Create event', exact: true })
  ).toBeEnabled();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('data-original', 'true');
  expect(
    await input.evaluate(
      (element: HTMLTextAreaElement) => element.selectionStart
    )
  ).toBe('Call John at 3pm tomorrow'.length);
  await expect(page.getByLabel('Starts', { exact: true })).toHaveValue(
    '2026-10-10T15:00'
  );
  await expect(page.getByLabel('Invite guests (optional)')).toHaveValue('');
  await input.press('Enter');
  await expect(input).toHaveValue('Call John at 3pm tomorrow\n');
  await expect(page.getByTestId('submission-count')).toHaveText('0');
  await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue('Call John at 3pm tomorrow');
  await expect(
    page.getByRole('button', { name: 'Create event', exact: true })
  ).toBeEnabled();
  await page.screenshot({
    path: '/tmp/universal-input-calendar.png',
    fullPage: true,
  });
});

test('locks edited fields, recovers the draft, and submits the visible event once', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await input.fill('Call John at 3pm tomorrow');
  const submit = page.getByRole('button', {
    name: 'Create event',
    exact: true,
  });
  await expect(submit).toBeEnabled();
  await page.getByLabel('Title', { exact: true }).fill('Call Jane');
  await expect(page.getByLabel('Content type')).toHaveValue('calendar');
  await input.fill('Email John instead');
  await expect(submit).toBeEnabled();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    'Call Jane'
  );
  await page.reload();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    'Call Jane'
  );
  await expect(submit).toBeEnabled();
  await input.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('submission-count')).toHaveText('1');
  await expect(page.getByTestId('last-submission')).toContainText('Call Jane');
  await expect(input).toHaveValue('');
});

test('shows outgoing email content and recipient before sending', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Your input', exact: true })
    .fill('Email John that I’ll be late');
  await expect(
    page.getByRole('button', { name: 'Send email', exact: true })
  ).toBeEnabled();
  await expect(page.getByLabel('Outgoing message')).toHaveValue('I’ll be late');
  await expect(page.getByText('John Adams <john@example.com>')).toBeVisible();
  await expect(page.getByTestId('submission-count')).toHaveText('0');
  await page.screenshot({
    path: '/tmp/universal-input-email.png',
    fullPage: true,
  });
});
