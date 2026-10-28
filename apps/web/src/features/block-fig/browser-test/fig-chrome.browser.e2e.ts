import { expect, type Page, test } from '@playwright/test';

async function open(page: Page) {
  await page.goto('/?file=showcase.fig&edit');
  await expect(page.getByTestId('fig-toolbar')).toBeVisible();
  await expect(page.getByTestId('fig-layer-row')).toHaveCount(2);
}

async function selectHome(page: Page) {
  await page.getByTestId('fig-layer-row').filter({ hasText: 'Home' }).click();
  await expect(page.getByTestId('fig-name')).toHaveValue('Home');
}

test('groups drawing tools, remembers the chosen shape, and supports keyboard menus', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByTestId('fig-tool-ellipse')).toHaveCount(0);
  const shapeMenu = page.getByTestId('fig-tool-menu-rectangle');
  await shapeMenu.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menu', { name: 'Shape tools' })).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByTestId('fig-choose-ellipse')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fig-tool-ellipse')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(shapeMenu).toBeFocused();
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('v');
  await expect(page.getByTestId('fig-tool-ellipse')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await page.getByTestId('fig-tool-ellipse').click();
  await expect(page.getByTestId('fig-tool-ellipse')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await shapeMenu.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Shape tools' })).toBeHidden();
  await expect(shapeMenu).toBeFocused();
});

test('opens search from Assets with the find shortcut, then returns to layers', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByTestId('fig-layer-search')).toHaveCount(0);
  await page.getByTestId('fig-tab-assets').click();
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('ControlOrMeta+f');
  const search = page.getByTestId('fig-layer-search');
  await expect(search).toBeFocused();
  await search.fill('Primary button');
  await page.getByTestId('fig-search-hit').click();
  await expect(page.getByTestId('fig-name')).toHaveValue('Primary button');
  await search.press('Escape');
  await expect(search).toHaveCount(0);
  await expect(page.getByTestId('fig-search-toggle')).toBeFocused();
  await expect(page.getByTestId('fig-layers-heading')).toHaveText('Layers');
  await expect(page.getByTestId('fig-page')).toHaveCount(2);
});

test('keeps view controls in the inspector and drawing tools on one row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page);
  const toolbar = page.getByTestId('fig-toolbar');
  await expect(toolbar.getByTestId('fig-zoom-menu')).toHaveCount(0);
  await expect(
    page.getByTestId('fig-design-panel').getByTestId('fig-zoom-menu')
  ).toBeVisible();
  const [tools, canvas] = await Promise.all([
    toolbar.boundingBox(),
    page.getByTestId('fig-canvas').boundingBox(),
  ]);
  expect(tools).not.toBeNull();
  expect(canvas).not.toBeNull();
  expect(tools!.height).toBeLessThanOrEqual(52);
  expect(tools!.x).toBeGreaterThanOrEqual(canvas!.x);
  expect(tools!.x + tools!.width).toBeLessThanOrEqual(
    canvas!.x + canvas!.width
  );
  await page.getByTestId('fig-zoom-menu').click();
  await expect(
    page.getByRole('menu', { name: 'Zoom and view options' })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fig-zoom-menu')).toBeFocused();
});

test('edits position, dimensions and appearance, and undoes from the file menu', async ({
  page,
}) => {
  await open(page);
  await selectHome(page);
  const position = page.getByTestId('fig-position-section');
  const layout = page.getByTestId('fig-auto-layout-section');
  await expect(position.getByTestId('fig-field-x')).toBeVisible();
  await expect(position.getByTestId('fig-field-w')).toHaveCount(0);
  await expect(layout.getByTestId('fig-field-w')).toBeVisible();
  const radius = page.getByTestId('fig-field-radius');
  await radius.fill('16');
  await radius.press('Enter');
  await expect(radius).toHaveValue('16');
  await page.getByTestId('fig-main-menu').click();
  await page.getByTestId('fig-main-edit').hover();
  await page.getByTestId('fig-undo').click();
  await expect(radius).toHaveValue('0');
  await expect(page.getByTestId('fig-save-state')).toHaveAttribute(
    'data-state',
    'saved'
  );
});

test('switches Dev Mode and prototype without losing inspector mode on selection', async ({
  page,
}) => {
  await open(page);
  await selectHome(page);
  const dev = page.getByTestId('fig-panel-tab-code');
  await dev.click();
  await expect(dev).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByTestId('fig-layer-row')
    .filter({ hasText: 'Settings' })
    .click();
  await expect(dev).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('fig-panel-tab-prototype').click();
  await expect(dev).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('fig-panel-tab-design').click();
  await expect(page.getByTestId('fig-position-section')).toBeVisible();
});

test('uses light editor chrome when the app is in light mode', async ({
  page,
}) => {
  await page.addInitScript(() =>
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.dataset.themeLight = 'true';
    })
  );
  await open(page);
  const panel = page.getByTestId('fig-design-panel');
  await expect
    .poll(() =>
      panel.evaluate((el) =>
        getComputedStyle(el).getPropertyValue('--color-panel').trim()
      )
    )
    .toBe('#ffffff');
  await page.getByTestId('fig-tool-menu-rectangle').click();
  await expect
    .poll(() =>
      page
        .getByRole('menu', { name: 'Shape tools' })
        .evaluate((el) => getComputedStyle(el).backgroundColor)
    )
    .toBe('rgb(255, 255, 255)');
});

test('resizes both panels and preserves their widths after hiding and showing them', async ({
  page,
}) => {
  await open(page);
  const left = page.getByTestId('fig-resize-left');
  await left.press('ArrowRight');
  await expect(left).toHaveAttribute('aria-valuenow', '288');
  await page.getByRole('button', { name: 'Hide layers', exact: true }).click();
  await expect(page.getByTestId('fig-layers-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Show layers', exact: true }).click();
  await expect(left).toHaveAttribute('aria-valuenow', '288');
  const right = page.getByTestId('fig-resize-right');
  await right.press('ArrowLeft');
  await expect(right).toHaveAttribute('aria-valuenow', '248');
  await page
    .getByRole('button', { name: 'Hide properties', exact: true })
    .click();
  await expect(page.getByTestId('fig-design-panel')).toBeHidden();
  await expect(page.getByTestId('fig-zoom-menu')).toBeVisible();
  await page
    .getByRole('button', { name: 'Show properties', exact: true })
    .click();
  await expect(right).toHaveAttribute('aria-valuenow', '248');
});

test('edits independent auto-layout padding without changing the other sides', async ({
  page,
}) => {
  await open(page);
  await selectHome(page);
  await page
    .getByRole('button', { name: 'Add auto layout', exact: true })
    .click();
  await page.getByTestId('fig-field-padding-h').fill('12');
  await page.getByTestId('fig-field-padding-h').press('Enter');
  await page.getByTestId('fig-padding-independent').click();
  await page.getByTestId('fig-field-padding-right').fill('28');
  await page.getByTestId('fig-field-padding-right').press('Enter');
  await expect(page.getByTestId('fig-field-padding-left')).toHaveValue('12');
  await expect(page.getByTestId('fig-field-padding-top')).toHaveValue('0');
  await expect(page.getByTestId('fig-field-padding-bottom')).toHaveValue('0');
  await expect(page.getByTestId('fig-field-padding-right')).toHaveValue('28');
  await page
    .getByTestId('fig-layer-row')
    .filter({ hasText: 'Settings' })
    .click();
  await selectHome(page);
  await expect(page.getByTestId('fig-field-padding-right')).toHaveValue('28');
});

test('shows only the comment tool as active and exits comments when a drawing tool is chosen', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('fig-tool-comment').click();
  await expect(page.getByTestId('fig-tool-comment')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByTestId('fig-tool-move')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await page.getByTestId('fig-tool-rectangle').click();
  await expect(page.getByTestId('fig-tool-comment')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await expect(page.getByTestId('fig-tool-rectangle')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByTestId('fig-design-panel')).toBeVisible();
});

test('navigates inspector and file tabs without nudging selected layers', async ({
  page,
}) => {
  await open(page);
  await selectHome(page);
  const x = await page.getByTestId('fig-field-x').inputValue();
  await page.getByTestId('fig-panel-tab-design').press('ArrowRight');
  await expect(page.getByTestId('fig-panel-tab-prototype')).toBeFocused();
  await expect(page.getByTestId('fig-panel-tab-prototype')).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await page.getByTestId('fig-panel-tab-prototype').press('Home');
  await expect(page.getByTestId('fig-field-x')).toHaveValue(x);
  await page.getByTestId('fig-tab-layers').press('ArrowRight');
  await expect(page.getByTestId('fig-tab-assets')).toBeFocused();
  await page.getByTestId('fig-tab-assets').press('Home');
  await expect(page.getByTestId('fig-layers-panel')).toBeVisible();
  await page.getByTestId('fig-resize-left').press('ArrowRight');
  await expect(page.getByTestId('fig-resize-left')).toHaveAttribute(
    'aria-valuenow',
    '288'
  );
  await expect(page.getByTestId('fig-field-x')).toHaveValue(x);
});

test('opens selection actions with the keyboard in the fixed inspector header', async ({
  page,
}) => {
  await open(page);
  await selectHome(page);
  const actions = page.getByTestId('fig-boolean-menu');
  await actions.press('ArrowDown');
  await expect(page.getByTestId('fig-menu-boolean-union')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByTestId('fig-menu-flatten')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();
});

test('keeps sizing beside its dimension and rotates through the inspector', async ({
  page,
}) => {
  await open(page);
  await selectHome(page);
  await page
    .getByRole('button', { name: 'Add auto layout', exact: true })
    .click();
  const width = page.getByTestId('fig-field-w');
  const sizing = page.getByTestId('fig-sizing-w');
  await sizing.click();
  await page.getByRole('option', { name: 'Hug', exact: true }).click();
  await expect(sizing).toHaveText('Hug');
  const [fieldBox, sizingBox] = await Promise.all([
    width.boundingBox(),
    sizing.boundingBox(),
  ]);
  expect(Math.abs(fieldBox!.y - sizingBox!.y)).toBeLessThanOrEqual(5);
  expect(sizingBox!.x).toBeGreaterThan(fieldBox!.x);
  await sizing.click();
  await page.getByRole('option', { name: 'Fixed', exact: true }).click();
  await width.fill('400');
  await width.press('Enter');
  await expect(width).toHaveValue('400');
  await page.getByTestId('fig-rotate-90').click();
  await expect(page.getByTestId('fig-field-rotation')).toHaveValue('90');
  await page.getByTestId('fig-main-menu').click();
  await page.getByTestId('fig-main-edit').hover();
  await page.getByTestId('fig-undo').click();
  await expect(page.getByTestId('fig-field-rotation')).toHaveValue('0');
});

test('toggles layer visibility in Appearance and keeps the layer selected', async ({
  page,
}) => {
  await open(page);
  await selectHome(page);
  const visible = page.getByTestId('fig-appearance-visible');
  await visible.click();
  await expect(visible).toHaveAttribute('aria-label', 'Show layer');
  await expect(page.getByTestId('fig-name')).toHaveValue('Home');
  await page.getByTestId('fig-main-menu').click();
  await page.getByTestId('fig-main-edit').hover();
  await page.getByTestId('fig-undo').click();
  await expect(visible).toHaveAttribute('aria-label', 'Hide layer');
});

test('keeps typography settings beside the inspector and applies text options', async ({
  page,
}) => {
  await page.goto('/?file=design-system.fig&edit');
  await page.getByTestId('fig-search-toggle').click();
  await page.getByTestId('fig-layer-search').fill('Heading');
  await page.getByTestId('fig-search-hit').click();
  await expect(page.getByTestId('fig-name')).toHaveValue('Heading');
  await expect(
    page.getByTestId('fig-auto-layout-section').getByTestId('fig-text-resize')
  ).toBeVisible();
  await expect(
    page.getByTestId('fig-type').getByTestId('fig-text-resize')
  ).toHaveCount(0);
  await page.getByTestId('fig-type-settings').click();
  const dialog = page.getByRole('dialog', { name: 'Type settings' });
  const [popup, inspector] = await Promise.all([
    dialog.boundingBox(),
    page.getByTestId('fig-design-panel').boundingBox(),
  ]);
  expect(popup!.x + popup!.width).toBeLessThanOrEqual(inspector!.x);
  await page.getByTestId('fig-underline').click();
  await expect(page.getByTestId('fig-underline')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.getByTestId('fig-text-case').click();
  await page.getByRole('option', { name: 'Uppercase', exact: true }).click();
  await expect(page.getByTestId('fig-text-case')).toHaveText('Uppercase');
  await page.getByTestId('fig-field-paragraph-spacing').fill('12');
  await page.getByTestId('fig-field-paragraph-spacing').press('Enter');
  await expect(page.getByTestId('fig-field-paragraph-spacing')).toHaveValue(
    '12'
  );
  await page.getByRole('button', { name: 'Close type settings' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('fig-type-settings')).toBeFocused();
});

test('browses local component previews, switches to a list, and inserts a searched component', async ({
  page,
}) => {
  await page.goto('/?file=design-system.fig&edit');
  await page.getByTestId('fig-tab-assets').click();
  const assets = page.getByTestId('fig-asset');
  await expect.poll(() => assets.count()).toBeGreaterThan(0);
  const count = await assets.count();
  await expect(assets.first().locator('img')).toBeVisible();
  await expect
    .poll(() =>
      assets
        .first()
        .locator('img')
        .evaluate((img: HTMLImageElement) => img.naturalWidth)
    )
    .toBeGreaterThan(0);
  await page.getByTestId('fig-assets-list').click();
  await expect(page.getByTestId('fig-asset-preview')).toHaveCount(0);
  await page.getByTestId('fig-assets-search').fill('Card');
  await expect(assets).toHaveCount(1);
  await assets.click();
  await expect(page.getByTestId('fig-main-component')).toHaveText('Card');
  await page.getByTestId('fig-assets-grid').click();
  await expect(assets.locator('img')).toBeVisible();
  await page.getByRole('button', { name: 'Clear asset search' }).click();
  await expect(assets).toHaveCount(count);
});

test('keeps the floating toolbar centered and usable in a narrow split', async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 720 });
  await open(page);
  const root = await page.getByTestId('fig-viewer').boundingBox();
  const toolbar = await page.getByTestId('fig-toolbar').boundingBox();
  expect(root).not.toBeNull();
  expect(toolbar).not.toBeNull();
  expect(toolbar!.x + toolbar!.width / 2).toBeCloseTo(
    root!.x + root!.width / 2,
    0
  );
  for (const button of await page
    .getByTestId('fig-toolbar')
    .getByRole('button')
    .all()) {
    const box = await button.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(root!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(root!.x + root!.width);
  }
  await page.getByTestId('fig-tool-menu-rectangle').click();
  await page.getByTestId('fig-choose-ellipse').click();
  await expect(page.getByTestId('fig-tool-ellipse')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('locks inspector dimensions proportionally and undoes both dimensions together', async ({
  page,
}) => {
  await open(page);
  await selectHome(page);
  const width = page.getByTestId('fig-field-w');
  const height = page.getByTestId('fig-field-h');
  const originalWidth = Number(await width.inputValue());
  const originalHeight = Number(await height.inputValue());
  await page.getByTestId('fig-lock-aspect-ratio').click();
  await width.fill(String(originalWidth * 2));
  await width.press('Enter');
  await expect(width).toHaveValue(String(originalWidth * 2));
  await expect(height).toHaveValue(String(originalHeight * 2));
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(width).toHaveValue(String(originalWidth));
  await expect(height).toHaveValue(String(originalHeight));
  await page.getByTestId('fig-lock-aspect-ratio').click();
  await width.fill(String(originalWidth + 20));
  await width.press('Enter');
  await expect(width).toHaveValue(String(originalWidth + 20));
  await expect(height).toHaveValue(String(originalHeight));
});

test('closes paint settings and returns focus to the swatch', async ({
  page,
}) => {
  await open(page);
  await selectHome(page);
  const swatch = page.getByTestId('fig-fill-0-swatch');
  await swatch.click();
  await expect(page.getByTestId('fig-color-picker')).toBeVisible();
  await page
    .getByRole('button', { name: 'Close edit fill', exact: true })
    .click();
  await expect(page.getByTestId('fig-color-picker')).toBeHidden();
  await expect(swatch).toBeFocused();
});

test('navigates font search results with arrow keys without moving the layer', async ({
  page,
}) => {
  await page.goto('/?file=design-system.fig&edit');
  await page.getByTestId('fig-search-toggle').click();
  await page.getByTestId('fig-layer-search').fill('Heading');
  await page.getByTestId('fig-search-hit').click();
  const x = await page.getByTestId('fig-field-x').inputValue();
  const y = await page.getByTestId('fig-field-y').inputValue();
  await page.getByTestId('fig-font-family').click();
  const search = page.getByTestId('fig-font-search');
  await search.fill('Roboto');
  const options = page.getByTestId('fig-font-option');
  await expect.poll(() => options.count()).toBeGreaterThan(1);
  const second = await options.nth(1).getAttribute('data-family');
  await search.press('ArrowDown');
  await expect(options.first()).toHaveAttribute('data-active', 'true');
  await search.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('data-active', 'true');
  await search.press('Enter');
  await expect(page.getByTestId('fig-font-picker')).toBeHidden();
  await expect(page.getByTestId('fig-font-family')).toHaveAttribute(
    'data-value',
    second!
  );
  await expect(page.getByTestId('fig-field-x')).toHaveValue(x);
  await expect(page.getByTestId('fig-field-y')).toHaveValue(y);
});

test('keeps effect settings open across edits and closes nested color settings independently', async ({
  page,
}) => {
  await open(page);
  await selectHome(page);
  await page.getByRole('button', { name: 'Add effects', exact: true }).click();
  await expect(page.getByTestId('fig-effect-0-y')).toBeHidden();
  const settings = page.getByTestId('fig-effect-0-settings');
  await settings.click();
  const popup = page.getByTestId('fig-effect-0-popover');
  await expect(popup).toBeVisible();
  for (const [field, value] of [
    ['y', '8'],
    ['blur', '20'],
    ['spread', '4'],
  ] as const) {
    const input = page.getByTestId(`fig-effect-0-${field}`);
    await input.fill(value);
    await input.press('Enter');
    await expect(input).toHaveValue(value);
    await expect(popup).toBeVisible();
  }
  await page.getByTestId('fig-effect-0-swatch').click();
  await page.getByTestId('fig-color-field-0').fill('FF6600');
  await page.getByTestId('fig-color-field-0').press('Enter');
  await expect(page.getByTestId('fig-color-field-0')).toHaveValue('FF6600');
  await page
    .getByRole('button', { name: 'Close shadow color', exact: true })
    .click();
  await expect(popup).toBeVisible();
  await expect(page.getByTestId('fig-color-picker')).toBeHidden();
  await page
    .getByRole('button', { name: 'Close effect settings', exact: true })
    .click();
  await expect(popup).toBeHidden();
  await expect(settings).toBeFocused();
});

test('searches comment text, replies and authors, and keeps view controls in the comments header', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const fixture = window.figFixture;
    const pageId = fixture.engine()!.summary.pages[0].id;
    const anchor = { pageId, nodeId: null, x: 100, y: 100 };
    const threadId = fixture.comments.arrive(
      fixture.comments.people[1],
      'Review the spacing',
      { anchor }
    );
    fixture.comments.arrive(fixture.comments.people[2], 'Typography is ready', {
      threadId,
    });
    fixture.comments.arrive(fixture.comments.people[0], 'Update the icon', {
      anchor: { ...anchor, x: 300 },
    });
  });
  await page.getByTestId('fig-tool-comment').click();
  const panel = page.getByTestId('fig-comments-panel');
  await expect(panel.getByTestId('fig-zoom-menu')).toBeVisible();
  await expect(panel.getByTestId('fig-present-button')).toBeVisible();
  await expect(panel.getByTestId('fig-comment-row')).toHaveCount(2);
  const search = panel.getByTestId('fig-comments-search');
  await search.fill('typography');
  await expect(panel.getByTestId('fig-comment-row')).toHaveCount(1);
  await expect(panel.getByTestId('fig-comment-row')).toContainText(
    'Review the spacing'
  );
  await search.fill('casey');
  await expect(panel.getByTestId('fig-comment-row')).toHaveCount(1);
  await search.fill('not in this file');
  await expect(panel.getByTestId('fig-comments-empty')).toHaveText(
    'No matching comments.'
  );
  await panel.getByRole('button', { name: 'Clear comment search' }).click();
  await expect(panel.getByTestId('fig-comment-row')).toHaveCount(2);
  await panel.getByTestId('fig-comments-filter').click();
  await page.getByTestId('fig-comments-filter-resolved').click();
  await expect(panel.getByTestId('fig-comments-empty')).toHaveText(
    'No resolved comments.'
  );
  await panel.getByRole('button', { name: 'Hide properties' }).click();
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: 'Show properties' }).click();
  await expect(panel).toBeVisible();
});

test('uses the same inspector sections for multiple selected layers', async ({
  page,
}) => {
  await open(page);
  await selectHome(page);
  await page
    .getByTestId('fig-layer-row')
    .filter({ hasText: 'Settings' })
    .click({ modifiers: ['Shift'] });
  const panel = page.getByTestId('fig-design-panel');
  await expect(panel).toContainText('2 layers selected');
  await expect(panel.getByTestId('fig-boolean-menu')).toBeVisible();
  const position = panel.getByTestId('fig-position-section');
  const layout = panel.getByTestId('fig-auto-layout-section');
  await expect(position.getByTestId('fig-align-left')).toBeVisible();
  await expect(position.getByTestId('fig-field-rotation')).toBeVisible();
  await expect(position.getByTestId('fig-field-w')).toHaveCount(0);
  await expect(layout.getByTestId('fig-field-w')).toBeVisible();
  await panel.getByTestId('fig-boolean-menu').focus();
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('menu', { name: 'Boolean groups' })
  ).toBeVisible();
  await page.keyboard.press('Escape');
});

test('navigates main-menu categories by keyboard without moving the selection', async ({
  page,
}) => {
  await open(page);
  await selectHome(page);
  const x = await page.getByTestId('fig-field-x').inputValue();
  const menu = page.getByTestId('fig-main-menu');
  await menu.focus();
  await page.keyboard.press('ArrowDown');
  await page.getByTestId('fig-main-edit').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('fig-main-copy')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('fig-main-edit')).toBeFocused();
  await page.getByTestId('fig-main-view').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('fig-zoom-100')).toBeVisible();
  await page.getByTestId('fig-zoom-100').focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeFocused();
  await expect(page.getByTestId('fig-zoom-menu')).toContainText('100%');
  await expect(page.getByTestId('fig-field-x')).toHaveValue(x);
});

test('runs a grouped object command from the main menu and undoes it', async ({
  page,
}) => {
  await open(page);
  await selectHome(page);
  await page.getByTestId('fig-main-menu').click();
  await page.getByTestId('fig-main-object').hover();
  await page.getByTestId('fig-main-toggle-visible').click();
  await expect(page.getByTestId('fig-appearance-visible')).toHaveAttribute(
    'aria-label',
    'Show layer'
  );
  await page.getByTestId('fig-main-menu').click();
  await page.getByTestId('fig-main-edit').hover();
  await page.getByTestId('fig-undo').click();
  await expect(page.getByTestId('fig-appearance-visible')).toHaveAttribute(
    'aria-label',
    'Hide layer'
  );
});

test('keeps prototype interaction rows compact and opens persistent settings beside the inspector', async ({
  page,
}) => {
  await page.goto('/?file=prototype.fig&edit');
  await expect(page.getByTestId('fig-toolbar')).toBeVisible();
  await page.getByTestId('fig-search-toggle').click();
  await page.getByTestId('fig-layer-search').fill('Next');
  await page.getByTestId('fig-search-hit').click();
  await page.getByTestId('fig-panel-tab-prototype').click();
  const row = page.getByTestId('fig-proto-open');
  const bounds = await row.boundingBox();
  expect(bounds!.height).toBeLessThanOrEqual(32);
  await expect(page.getByTestId('fig-proto-settings')).toHaveCount(0);
  await row.press('Enter');
  const settings = page.getByTestId('fig-proto-settings');
  await expect(settings).toBeVisible();
  const [popoverBounds, panelBounds] = await Promise.all([
    settings.boundingBox(),
    page.getByRole('complementary', { name: 'Properties' }).boundingBox(),
  ]);
  expect(popoverBounds!.x + popoverBounds!.width).toBeLessThanOrEqual(
    panelBounds!.x
  );
  await page.getByTestId('fig-proto-destination').click();
  await page.getByRole('option', { name: 'Done', exact: true }).click();
  await expect(settings).toBeVisible();
  await expect(row).toContainText('Done');
  await page
    .getByRole('button', { name: 'Close interaction settings' })
    .click();
  await expect(row).toBeFocused();
  await expect(settings).toHaveCount(0);
});

test('creates a component from the selection header and undoes it', async ({
  page,
}) => {
  await open(page);
  await selectHome(page);
  await page.getByTestId('fig-create-component').click();
  await expect(page.getByTestId('fig-create-component')).toHaveCount(0);
  await expect(page.getByTestId('fig-component-section')).toBeVisible();
  await page.getByTestId('fig-main-menu').click();
  await page.getByTestId('fig-main-edit').hover();
  await page.getByTestId('fig-undo').click();
  await expect(page.getByTestId('fig-create-component')).toBeVisible();
  await expect(page.getByTestId('fig-name')).toHaveValue('Home');
});

test('disables selection commands when there is no selection', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('fig-main-menu').click();
  await page.getByTestId('fig-main-edit').hover();
  await expect(page.getByTestId('fig-main-copy')).toHaveAttribute(
    'aria-disabled',
    'true'
  );
  await expect(page.getByTestId('fig-main-paste')).not.toHaveAttribute(
    'aria-disabled',
    'true'
  );
  await page.keyboard.press('Escape');
  await selectHome(page);
  await page.getByTestId('fig-main-menu').click();
  await page.getByTestId('fig-main-edit').hover();
  await expect(page.getByTestId('fig-main-copy')).not.toHaveAttribute(
    'aria-disabled',
    'true'
  );
});

test('drags panel edges without drawing or moving the selected layer', async ({
  page,
}) => {
  await open(page);
  await selectHome(page);
  await page.getByTestId('fig-tool-rectangle').click();
  const left = page.getByTestId('fig-resize-left');
  const right = page.getByTestId('fig-resize-right');
  for (const [edge, delta, expected] of [
    [left, 64, '344'],
    [right, -48, '288'],
  ] as const) {
    const box = await edge.boundingBox();
    const x = box!.x + box!.width / 2;
    const y = box!.y + 200;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + delta, y, { steps: 8 });
    await page.mouse.up();
    await expect(edge).toHaveAttribute('aria-valuenow', expected);
    await page.mouse.move(720, 300);
    await expect(edge).toHaveAttribute('aria-valuenow', expected);
  }
  await expect(page.getByTestId('fig-layer-row')).toHaveCount(2);
  await expect(page.getByTestId('fig-name')).toHaveValue('Home');
  await expect(page.getByTestId('fig-field-x')).toHaveValue('0');
  await expect(page.getByTestId('fig-field-w')).toHaveValue('360');
});
