import { expect, test } from '@playwright/test';

const FIXTURE = '/src/components/view-shell/browser-test/sidebar-reorder.html';

const sectionOrder = () =>
  [...document.querySelectorAll<HTMLElement>('[data-sidebar-section]')].map(
    (section) => section.dataset.sidebarSection
  );

test('mouse reordering persists per view without toggling sections', async ({
  page,
}, info) => {
  await page.goto(FIXTURE);
  const last = page.getByRole('button', { name: 'Last', exact: true });
  await last.dragTo(page.getByRole('button', { name: 'First', exact: true }));
  await expect
    .poll(() => page.evaluate(sectionOrder))
    .toEqual(['Last', 'First', 'Middle']);
  await expect(last).toHaveAttribute('aria-expanded', 'true');
  const content = page.locator('[data-view-sidebar-content]');
  await expect(content.locator(':scope > :first-child')).toHaveText(
    'Fixed top'
  );
  await expect(content.locator(':scope > :last-child')).toHaveText(
    'Fixed bottom'
  );
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('reordered.png'),
  });

  await page.reload();
  await expect
    .poll(() => page.evaluate(sectionOrder))
    .toEqual(['Last', 'First', 'Middle']);
  await page.getByRole('button', { name: 'Drive fixture' }).click();
  await expect
    .poll(() => page.evaluate(sectionOrder))
    .toEqual(['First', 'Middle', 'Last']);
  await page.getByRole('button', { name: 'Mail fixture' }).click();
  await expect
    .poll(() => page.evaluate(sectionOrder))
    .toEqual(['Last', 'First', 'Middle']);
});

test('keyboard reordering retains focus, input values, collapse, and header actions', async ({
  page,
}) => {
  await page.goto(FIXTURE);
  await page
    .getByRole('textbox', { name: 'First draft' })
    .fill('Keep this draft');
  const handle = page.getByRole('button', {
    name: 'Reorder First',
    exact: true,
  });
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(() => page.evaluate(sectionOrder))
    .toEqual(['Middle', 'First', 'Last']);
  await expect(handle).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'First draft' })).toHaveValue(
    'Keep this draft'
  );
  await page.getByRole('button', { name: 'Action First', exact: true }).click();
  await expect(page.getByText('First action count: 1')).toBeVisible();
  const first = page.getByRole('button', { name: 'First', exact: true });
  await first.click();
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await first.click();
  await expect(first).toHaveAttribute('aria-expanded', 'true');
});

test.describe('touch', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('keeps phone collapse and header actions without drag controls', async ({
    page,
  }, info) => {
    await page.goto(FIXTURE);
    await expect(page.getByRole('button', { name: /^Reorder / })).toHaveCount(
      0
    );
    const first = page.getByRole('button', { name: 'First', exact: true });
    await first.tap();
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await first.tap();
    await page.getByRole('button', { name: 'Action First', exact: true }).tap();
    await expect(page.getByText('First action count: 1')).toBeVisible();
    await expect
      .poll(() => page.evaluate(sectionOrder))
      .toEqual(['First', 'Middle', 'Last']);
    expect(await page.evaluate(() => window.innerWidth)).toBe(390);
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath('phone.png'),
    });
  });
});
