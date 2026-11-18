import { expect, test } from '@playwright/test';
import { toggleChecklistMarker } from '../../behavior-inventory/browser-test/browser-hooks';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
});

test('native checkbox marker toggles and restores its exact saved model', async ({
  page,
  hasTouch,
}, info) => {
  const checkbox = page.getByRole('checkbox');
  await expect(checkbox).not.toBeChecked();
  expect(await checkbox.getAttribute('tabindex')).toBeNull();
  await toggleChecklistMarker(page, checkbox, hasTouch);
  await expect(checkbox).toBeChecked();
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  const saved = await page.locator('#saved').textContent();
  if (!saved) throw new Error('Missing actual native saved state');
  await toggleChecklistMarker(page, checkbox, hasTouch);
  await expect(checkbox).not.toBeChecked();
  await page
    .getByRole('button', { name: 'Reopen saved state', exact: true })
    .click();
  await expect(checkbox).toBeChecked();
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  const reopened = await page.locator('#saved').textContent();
  await info.attach('raw-native-roundtrip', {
    body: JSON.stringify({ saved, reopened }),
    contentType: 'application/json',
  });
  // Actual Source import adds this field too; every other native byte and ID
  // must remain exact. Neither actual snapshot is normalized or masked.
  expect(saved).toContain('"documentMetadata":{"version":11}');
  expect(reopened).toBe(
    saved.replace(
      '"documentMetadata":{"version":11}',
      '"documentMetadata":{"version":11,"environmentTags":null}'
    )
  );
  await expect(page.locator('#errors')).toHaveText('');
});

test('readonly UI rejects the native marker and overlay remount owns exactly one listener', async ({
  page,
  hasTouch,
}) => {
  const checkbox = page.getByRole('checkbox');
  await page.getByRole('button', { name: 'Read only', exact: true }).click();
  await toggleChecklistMarker(page, checkbox, hasTouch);
  await expect(checkbox).not.toBeChecked();
  await page.getByRole('button', { name: 'Editable', exact: true }).click();
  await toggleChecklistMarker(page, checkbox, hasTouch);
  await expect(checkbox).toBeChecked();
  await page
    .getByRole('button', { name: 'Dispose overlays', exact: true })
    .click();
  await toggleChecklistMarker(page, checkbox, hasTouch);
  await expect(checkbox).toBeChecked();
  await page
    .getByRole('button', { name: 'Remount overlays', exact: true })
    .click();
  await toggleChecklistMarker(page, checkbox, hasTouch);
  await expect(checkbox).not.toBeChecked();
  await expect(page.locator('#errors')).toHaveText('');
});

test('current Session access rejects a marker write while the UI remains editable', async ({
  page,
  hasTouch,
}) => {
  const checkbox = page.getByRole('checkbox');
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  const saved = await page.locator('#saved').textContent();
  await page
    .getByRole('button', { name: 'Revoke writes', exact: true })
    .click();
  await expect(page.getByRole('textbox')).toHaveAttribute(
    'contenteditable',
    'true'
  );
  await toggleChecklistMarker(page, checkbox, hasTouch);
  await expect(checkbox).not.toBeChecked();
  await expect(page.locator('#errors')).toHaveText(
    '["Error: document is read-only"]'
  );
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  expect(await page.locator('#saved').textContent()).toBe(saved);
});

test('keyboard checkbox toggle is one undoable edit and preserves checked styling', async ({
  page,
}) => {
  const checkbox = page.getByRole('checkbox');
  await checkbox.getByText('Retained check', { exact: true }).click();
  const before = await page.locator('#live-state').textContent();
  await page.keyboard.press('Control+Enter');
  await expect(checkbox).toBeChecked();
  const after = await page.locator('#live-state').textContent();
  expect(after).not.toBe(before);
  await expect(checkbox).toHaveClass(/md-strike/);
  await page.keyboard.press('Control+z');
  await expect(checkbox).not.toBeChecked();
  await expect(page.locator('#live-state')).toHaveText(before ?? '');
  await page.keyboard.press('Control+Shift+z');
  await expect(checkbox).toBeChecked();
  await expect(page.locator('#live-state')).toHaveText(after ?? '');
  await expect(page.locator('#errors')).toHaveText('');
});

test('descendant edits restore checklist tabindex while own toggles clear it', async ({
  page,
  hasTouch,
}) => {
  const checkbox = page.getByRole('checkbox');
  await expect(page.getByRole('textbox').locator('ul')).toHaveClass(/md-check/);
  await checkbox.getByText('Retained check', { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect(checkbox).toContainText('Retained check!');
  await expect(checkbox).toHaveAttribute('tabindex', '-1');
  await toggleChecklistMarker(page, checkbox, hasTouch);
  await expect(checkbox).toBeChecked();
  expect(await checkbox.getAttribute('tabindex')).toBeNull();
  await expect(page.locator('#errors')).toHaveText('');
});
