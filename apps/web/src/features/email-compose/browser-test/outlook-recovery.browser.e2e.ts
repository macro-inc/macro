import { expect, type Page, test } from '@playwright/test';

async function uncertainSend(page: Page) {
  await page.goto('/?outlook-recovery&scenario=uncertain');
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send email' })).toBeDisabled();
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByTestId('resolutions')).toHaveText('recheck:7:false');
  await page.getByRole('button', { name: 'Retry send' }).click();
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await expect(
    page.getByText('The earlier attempt may already', { exact: false })
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('outlook-uncertain-send.png'),
  });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('resolutions')).toHaveText(
    'recheck:7:false,retry_send:7:true'
  );
  await expect(
    page.getByRole('status').filter({ hasText: 'Confirming delivery' })
  ).toBeVisible();
}

test('uncertain delivery requires explicit duplicate acknowledgement', async ({
  page,
}) => {
  await uncertainSend(page);
});

test.describe('mobile Outlook recovery', () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true });
  test('keeps the explanation and resend controls visible', async ({
    page,
  }) => {
    await uncertainSend(page);
  });
});

test('changing inbox keeps editing available while the original copy blocks sending', async ({
  page,
}) => {
  await page.goto('/?outlook-recovery&scenario=transfer');
  const editor = page.getByRole('textbox', { name: 'Message' });
  await editor.fill('Edits made while resolving the original');
  await expect(page.getByRole('button', { name: 'Send email' })).toBeDisabled();
  await page
    .getByRole('button', { name: 'Keep original copy and continue' })
    .click();
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('resolutions')).toHaveText(
    'keep_original:8:true'
  );
  await expect(editor).toHaveValue('Edits made while resolving the original');
  await expect(page.getByRole('button', { name: 'Send email' })).toBeEnabled();
});

test('accepting an external draft version requires reload before editing', async ({
  page,
}) => {
  await page.goto('/?outlook-recovery&scenario=conflict');
  const editor = page.getByRole('textbox', { name: 'Message' });
  await expect(editor).toBeDisabled();
  await page.getByRole('button', { name: 'Use mailbox version' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('resolutions')).toHaveText(
    'use_provider:9:false'
  );
  await expect(editor).toHaveValue('Saved Macro draft');
  await expect(editor).toBeDisabled();
  await page.getByRole('button', { name: 'Reload draft' }).click();
  await expect(editor).toHaveValue('Latest mailbox draft');
  await expect(editor).toBeEnabled();
});
