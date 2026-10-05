import { expect, type Page, test } from '@playwright/test';

// Design systems on `design-system.fig` (made by the engine's own
// operations; see `fig_engine::testing::design_system`): an instance's
// properties and variants, main components' properties and variants,
// layers bound to properties, and shared styles. Saves reopen to check
// they round-trip.

async function open(page: Page) {
  await page.goto('/?file=design-system.fig&edit&reload');
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  await expect(page.getByTestId('fig-layer-row').first()).toBeVisible();
}

/** Selects the layer named exactly `name` on the open page. */
async function select(page: Page, name: string) {
  await page.getByTestId('fig-layer-search').fill(name);
  await page
    .getByTestId('fig-search-hit')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first()
    .click();
  await page.getByTestId('fig-layer-search').fill('');
}

async function openPage(page: Page, name: string) {
  await page.getByTestId('fig-page').filter({ hasText: name }).click();
  await expect(page.getByTestId('fig-layer-row').first()).toBeVisible();
}

async function expectSavedCleanly(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.figFixture.saves().length), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.figFixture.errors()))
    .toEqual([]);
}

test('sets an instance’s properties, swaps it, and resets it', async ({
  page,
}) => {
  await open(page);
  await select(page, 'Card');
  const section = page.getByTestId('fig-instance-section');
  await expect(section).toBeVisible();
  await expect(page.getByTestId('fig-main-component')).toHaveText('Card');
  await expect(page.getByTestId('fig-reset-instance')).toBeDisabled();

  // Text property.
  const title = page.getByTestId('fig-prop-Title');
  await expect(title).toHaveValue('Card title');
  await title.fill('Hello there');
  await title.press('Enter');
  await expect(page.getByTestId('fig-prop-reset-Title')).toBeVisible();
  await expect(title).toHaveValue('Hello there');
  await page.getByTestId('fig-prop-reset-Title').click();
  await expect(title).toHaveValue('Card title');

  // Boolean property.
  const show = page.getByTestId('fig-prop-Show-icon');
  await expect(show).toBeChecked();
  await show.uncheck();
  await expect(page.getByTestId('fig-prop-reset-Show-icon')).toBeVisible();
  await expect(show).not.toBeChecked();

  // Instance swap property: the picker lists the file's components.
  await page.getByTestId('fig-prop-Icon').click();
  await page
    .getByTestId('fig-component-choice')
    .filter({ hasText: 'Icon/Heart' })
    .click();
  await expect(page.getByTestId('fig-prop-Icon')).toContainText('Icon/Heart');

  // Reset all changes.
  await expect(page.getByTestId('fig-reset-instance')).toBeEnabled();
  await page.getByTestId('fig-reset-instance').click();
  await expect(show).toBeChecked();
  await expect(page.getByTestId('fig-prop-Icon')).toContainText('Icon/Star');

  // Swap instance.
  await page.getByTestId('fig-swap-instance').click();
  await page
    .getByTestId('fig-component-choice')
    .filter({ hasText: 'Icon/Heart' })
    .click();
  await expect(page.getByTestId('fig-main-component')).toHaveText('Icon/Heart');
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('fig-main-component')).toHaveText('Card');

  // Go to main component.
  await page.getByTestId('fig-go-to-main').click();
  await expect(page.getByTestId('fig-name')).toHaveValue('Card');
  await expect(page.getByTestId('fig-component-section')).toBeVisible();
  await expectSavedCleanly(page);
});

test('switches variants of an instance', async ({ page }) => {
  await open(page);
  await select(page, 'Button');
  const type = page.getByTestId('fig-variant-Type');
  await expect(type).toHaveValue('Primary');
  await expect(type.locator('option')).toHaveText(['Primary', 'Secondary']);
  await type.selectOption('Secondary');
  await expect(type).toHaveValue('Secondary');
  // The text property survives the switch.
  const label = page.getByTestId('fig-prop-Label');
  await label.fill('Go');
  await label.press('Enter');
  await type.selectOption('Primary');
  await expect(type).toHaveValue('Primary');
  await expect(label).toHaveValue('Go');
  await expectSavedCleanly(page);
});

test('edits a component set’s variants and properties', async ({ page }) => {
  await open(page);
  await openPage(page, 'Components');
  await select(page, 'Button');
  const section = page.getByTestId('fig-component-section');
  await expect(section).toContainText('Component set');
  const typeName = page.getByTestId('fig-variant-property-Type');
  await typeName.fill('Kind');
  await typeName.press('Enter');
  await expect(page.getByTestId('fig-variant-property-Kind')).toBeVisible();

  // A new variant is selected; its values can be changed.
  await page.getByTestId('fig-add-variant').click();
  await expect(section).toContainText('Variant');
  const kind = page.getByTestId('fig-variant-value-Kind');
  await kind.fill('Ghost');
  await kind.press('Enter');
  await expect(page.getByTestId('fig-name')).toHaveValue(
    'Kind=Ghost, Size=Medium'
  );

  // Create a boolean property on the set.
  await section.getByRole('button', { name: 'Add variant' }).first().click();
  await expect(page.getByTestId('fig-new-property')).toBeVisible();
  await page.getByTestId('fig-new-property-kind').selectOption('BOOL');
  await page.getByTestId('fig-new-property-name').fill('Disabled');
  await page.getByTestId('fig-new-property-create').click();
  await expect(page.getByTestId('fig-property-name-Disabled')).toBeVisible();
  await page.getByTestId('fig-property-delete-Disabled').click();
  await expect(page.getByTestId('fig-property-name-Disabled')).toHaveCount(0);
  await expectSavedCleanly(page);
});

test('binds layers of a main component to properties', async ({ page }) => {
  await open(page);
  await openPage(page, 'Components');
  await select(page, 'Background');
  const bindings = page.getByTestId('fig-bindings-section');
  await expect(bindings).toBeVisible();
  const visible = page.getByTestId('fig-bind-VISIBLE');
  await expect(visible).toHaveValue('');
  // "Create boolean property…" makes one from the layer and binds it.
  await visible.selectOption({ label: 'Create boolean property…' });
  await expect(visible.locator('option:checked')).toHaveText('Show');
  await visible.selectOption({ label: 'Show icon' });
  await expect(visible.locator('option:checked')).toHaveText('Show icon');
  await visible.selectOption({ label: 'None' });
  await expect(visible).toHaveValue('');
  await expectSavedCleanly(page);
});

test('applies, creates, edits, and detaches styles', async ({ page }) => {
  await open(page);
  // Nothing selected: the local styles.
  const styles = page.getByTestId('fig-local-styles');
  await expect(styles).toBeVisible();
  await expect(page.getByTestId('fig-local-style')).toHaveCount(3);
  await expect(styles).toContainText('Color styles');
  await expect(styles).toContainText('Text styles');
  await expect(styles).toContainText('Effect styles');

  // Renaming a style shows wherever it is used.
  await page
    .locator('[data-style-name="Brand/Primary"]')
    .getByRole('button')
    .first()
    .click();
  const name = page.getByTestId('fig-local-style-name');
  await name.fill('Brand/Main');
  await name.press('Enter');
  await select(page, 'Swatch');
  await expect(page.getByTestId('fig-style-FILL')).toHaveText('Main');

  // Detach, then apply again from the picker.
  await page.getByTestId('fig-style-detach-FILL').click();
  await expect(page.getByTestId('fig-style-FILL')).toHaveCount(0);
  await page.getByTestId('fig-style-picker-FILL').click();
  await page
    .getByTestId('fig-style-option')
    .filter({ hasText: 'Main' })
    .click();
  await expect(page.getByTestId('fig-style-FILL')).toHaveText('Main');

  // A new style from a layer's fill.
  await select(page, 'Raised');
  await page.getByTestId('fig-style-picker-FILL').click();
  await page.getByTestId('fig-style-create-name').fill('Surface');
  await page.getByTestId('fig-style-create').click();
  await expect(page.getByTestId('fig-style-FILL')).toHaveText('Surface');
  await expect(page.getByTestId('fig-style-EFFECT')).toHaveText('1');

  // The text style a heading uses.
  await select(page, 'Heading');
  await expect(page.getByTestId('fig-style-TEXT')).toContainText('Heading');
  await expectSavedCleanly(page);
});

test('lists variables, binds colors, and switches modes', async ({ page }) => {
  // `variables.fig`: a Theme collection (Light, Dark) with Surface and
  // Brand colors; a Screen frame and its Logo bound to them.
  await page.goto('/?file=variables.fig&edit&reload');
  await expect(page.getByTestId('fig-layer-row').first()).toBeVisible();
  await expect(page.getByTestId('fig-variables')).toContainText('Theme');
  await expect(page.getByTestId('fig-variable')).toHaveCount(2);

  await select(page, 'Screen');
  await expect(page.getByTestId('fig-variable-FILL')).toHaveText('Surface');
  await expect(page.getByTestId('fig-fill-0-hex')).toHaveValue('FFFFFF');
  const mode = page.getByTestId('fig-variable-mode-Theme');
  await mode.selectOption({ label: 'Dark' });
  await expect(page.getByTestId('fig-fill-0-hex')).toHaveValue('000000');

  // The logo's Brand color aliases Surface in the dark mode.
  await select(page, 'Logo');
  await expect(page.getByTestId('fig-fill-0-hex')).toHaveValue('000000');
  await page.getByTestId('fig-variable-detach-FILL').click();
  await expect(page.getByTestId('fig-variable-FILL')).toHaveCount(0);
  await page.getByTestId('fig-variable-picker-FILL').click();
  await page
    .getByTestId('fig-variable-option')
    .filter({ hasText: 'Brand' })
    .click();
  await expect(page.getByTestId('fig-variable-FILL')).toHaveText('Brand');
  await expectSavedCleanly(page);
});
