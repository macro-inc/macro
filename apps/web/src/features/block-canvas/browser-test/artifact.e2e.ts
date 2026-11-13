import { expect, type Page, test } from '@playwright/test';

const frameFor = (page: Page, id: string) =>
  page
    .locator(`[data-canvas-artifact="${id}"]`)
    .locator('iframe[data-canvas-artifact-frame]');

test('runs an artifact, passes input only while interacting', async ({
  page,
}) => {
  await page.goto('/artifact.html?edit');
  const node = page.locator('[data-canvas-artifact="First"]');
  const frame = frameFor(page, 'First');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveCSS('pointer-events', 'none');

  await node.hover();
  await node.getByRole('button', { name: 'Interact' }).click();
  await expect(frame).toHaveCSS('pointer-events', 'auto');

  const target = frame.contentFrame().locator('#target');
  // The frame draws at half its design size. Playwright's element coordinates
  // ignore that scale, so click where the button appears on screen. Input can
  // reach the canvas until the frame's new hit-test region has been painted.
  await expect(async () => {
    await page.mouse.click(110, 108);
    await expect(target).toHaveText('clicked', { timeout: 500 });
  }).toPass();

  await node.getByRole('button', { name: 'Done' }).click();
  await expect(frame).toHaveCSS('pointer-events', 'none');
});

test('edits an artifact from the inspector', async ({ page }) => {
  await page.goto('/artifact.html?edit');
  await frameFor(page, 'First').waitFor();
  await page.mouse.click(200, 150);

  const html = page.getByLabel('Artifact HTML');
  await expect(html).toBeVisible();
  await html.fill('<p id="edited">Edited</p>');
  await html.blur();

  await expect(
    frameFor(page, 'First').contentFrame().locator('#edited')
  ).toHaveText('Edited');
});

test('presents artifacts in order, with keys working from inside a frame', async ({
  page,
}) => {
  await page.goto('/artifact.html?edit');
  const node = page.locator('[data-canvas-artifact="First"]');
  await frameFor(page, 'First').waitFor();
  await node.hover();
  await node.getByRole('button', { name: 'Present' }).click();

  const show = page.locator('[data-canvas-artifact-presentation]');
  const counter = page.getByTestId('canvas-artifact-presentation-counter');
  const target = show
    .locator('iframe[data-canvas-artifact-frame]')
    .contentFrame()
    .locator('#target');
  await expect(counter).toHaveText('1 / 2');
  await expect(target).toHaveText('First');

  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('2 / 2');
  await expect(target).toHaveText('Second');

  // Stops at the end rather than wrapping.
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('2 / 2');

  await page.getByRole('button', { name: 'Previous artifact' }).click();
  await expect(counter).toHaveText('1 / 2');

  // With focus inside the frame, keys reach the host only through its bridge.
  await show
    .locator('iframe[data-canvas-artifact-frame]')
    .contentFrame()
    .locator('body')
    .evaluate((body) => {
      body.tabIndex = 0;
      body.focus();
    });
  await show
    .locator('iframe[data-canvas-artifact-frame]')
    .contentFrame()
    .locator('body')
    .press('ArrowRight');
  await expect(counter).toHaveText('2 / 2');
  await show
    .locator('iframe[data-canvas-artifact-frame]')
    .contentFrame()
    .locator('body')
    .press('Escape');
  await expect(show).toHaveCount(0);
});

test('reorders the presentation from the inspector', async ({ page }) => {
  await page.goto('/artifact.html?edit');
  await frameFor(page, 'First').waitFor();
  await page.mouse.click(200, 150);

  await expect(page.getByText('Presented 1 of 2')).toBeVisible();
  await page.getByRole('button', { name: 'Later' }).click();
  await expect(page.getByText('Presented 2 of 2')).toBeVisible();

  // The selection overlay covers the node's own controls while it is selected.
  await page
    .getByRole('region', { name: 'Artifact' })
    .getByRole('button', { name: 'Present' })
    .click();
  await expect(
    page.getByTestId('canvas-artifact-presentation-counter')
  ).toHaveText('2 / 2');
});

test('double-clicking a selected artifact starts interacting', async ({
  page,
}) => {
  await page.goto('/artifact.html?edit');
  const frame = frameFor(page, 'First');
  await frame.waitFor();
  await page.mouse.click(200, 150);
  await expect(page.getByLabel('Artifact HTML')).toBeVisible();

  await page.mouse.dblclick(200, 150);
  await expect(frame).toHaveCSS('pointer-events', 'auto');
});

const KINDS = [
  'none',
  'fade',
  'fadeThroughBlack',
  'dissolve',
  'push',
  'cover',
  'uncover',
  'wipe',
  'split',
  'iris',
  'zoom',
  'flip',
  'cube',
  'pan',
  'fly',
  'overview',
  'path',
] as const;

/** Opens the spatial deck and presents it from slide 1. */
async function presentDeck(page: Page) {
  await page.goto('/artifact.html?edit&deck');
  const node = page.locator('[data-canvas-artifact="1"]');
  await frameFor(page, '1').waitFor();
  await node.hover();
  await node.getByRole('button', { name: 'Present' }).click();
  const counter = page.getByTestId('canvas-artifact-presentation-counter');
  await expect(counter).toHaveText('1 / 4');
  return counter;
}

const setTransitions = (
  page: Page,
  transition: { kind: string; durationMs?: number } | null
) =>
  page.evaluate((value) => window.setSlideTransitions?.(value as never), transition);

/** The stage settled on one slide showing `id`. */
async function expectSettledOn(page: Page, id: string) {
  const stage = page.locator('[data-canvas-slide-stage]');
  await expect(stage).toHaveAttribute('data-canvas-transition-state', 'idle');
  const layers = stage.locator('[data-canvas-slide-layer]');
  await expect(layers).toHaveCount(1);
  await expect(layers).toHaveAttribute('data-canvas-slide-layer', id);
  await expect(stage.locator('[data-canvas-transition-flight]')).toHaveCount(0);
  await expect(
    layers.locator('iframe[data-canvas-artifact-frame]').contentFrame().locator('#target')
  ).toHaveText(id);
}

test('plays every transition kind forward and back to the right slide', async ({
  page,
}) => {
  const counter = await presentDeck(page);
  let position = 1;
  let step = 1;
  for (const kind of KINDS) {
    await setTransitions(page, { kind, durationMs: 300 });
    if (position + step < 1 || position + step > 4) step = -step;
    position += step;
    await page.keyboard.press(step > 0 ? 'ArrowRight' : 'ArrowLeft');
    await expect(counter).toHaveText(`${position} / 4`);
    await expectSettledOn(page, String(position));
  }
});

test('a key during a transition skips to the next slide without queueing', async ({
  page,
}) => {
  const counter = await presentDeck(page);
  for (const kind of ['push', 'fly'] as const) {
    await setTransitions(page, { kind, durationMs: 4000 });
    await page.keyboard.press('ArrowRight');
    const stage = page.locator('[data-canvas-slide-stage]');
    await expect(stage).toHaveAttribute('data-canvas-transition', kind);
    // The second press finishes the first transition at once and starts the
    // next; the third, from the frame, does the same.
    await page.keyboard.press('ArrowRight');
    await expect(counter).toHaveText('3 / 4');
    await expect(stage.locator('[data-canvas-slide-layer]')).toHaveCount(2);
    await page.keyboard.press('ArrowLeft');
    await expect(counter).toHaveText('2 / 4');
    await setTransitions(page, null);
    await page.getByRole('button', { name: 'Previous artifact' }).click();
    await expectSettledOn(page, '1');
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-canvas-artifact-presentation]')).toHaveCount(0);
});

test('a canvas transition flies over the real canvas around the slides', async ({
  page,
}) => {
  await presentDeck(page);
  await setTransitions(page, { kind: 'path', durationMs: 5000 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const flight = page.locator('[data-canvas-transition-flight]');
  await expect(flight).toHaveCount(1);
  await expect(flight.getByText('Notes between slides')).toBeAttached();
  await expect(flight.locator('[data-graphics-item="arrow"]')).toBeAttached();
  await page.getByRole('button', { name: 'Next artifact' }).click();
  await expect(page.getByTestId('canvas-artifact-presentation-counter')).toHaveText('4 / 4');
});

test('reduced motion plays every kind as a short fade', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const counter = await presentDeck(page);
  await setTransitions(page, { kind: 'cube', durationMs: 5000 });
  await page.keyboard.press('ArrowRight');
  const stage = page.locator('[data-canvas-slide-stage]');
  await expect(stage).toHaveAttribute('data-canvas-transition', 'fade');
  await expect(stage).toHaveAttribute('data-canvas-transition-state', 'idle', {
    timeout: 1500,
  });
  await expect(counter).toHaveText('2 / 4');
  await expectSettledOn(page, '2');
});

test('picks, times and previews a transition from the inspector', async ({
  page,
}) => {
  await page.goto('/artifact.html?edit&deck');
  await frameFor(page, '2').waitFor();
  const node = page.locator('[data-canvas-artifact="2"]');
  const box = await node.boundingBox();
  if (!box) throw new Error('Slide 2 is not on screen');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  const section = page.getByRole('region', { name: 'Transition' });
  await expect(section.getByRole('radio', { checked: true })).toHaveAttribute(
    'data-transition-tile',
    'default'
  );
  await section.getByRole('radio', { name: 'Push' }).click();
  await expect(section.getByRole('radio', { name: 'Push' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  // The segment's label covers its input.
  await section.getByRole('radio', { name: 'Up' }).locator('..').click();
  await expect(section.getByRole('radio', { name: 'Up' })).toBeChecked();
  const duration = section.getByRole('textbox', {
    name: 'Transition duration',
  });
  await duration.fill('1.5');
  await duration.press('Enter');
  await expect(duration).toHaveValue('1.5');

  // Undo takes back one edit at a time.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(duration).toHaveValue('0.5');
  await expect(section.getByRole('radio', { name: 'Push' })).toHaveAttribute(
    'aria-checked',
    'true'
  );

  await section.getByRole('button', { name: 'Preview' }).click();
  const preview = section.locator('[data-canvas-transition-preview]');
  await expect(preview.locator('[data-canvas-slide-stage]')).toHaveAttribute(
    'data-canvas-transition',
    'push'
  );
  await expect(preview.locator('[data-canvas-slide-stage]')).toHaveAttribute(
    'data-canvas-transition-state',
    'idle'
  );
  await expect(preview.locator('[data-canvas-slide-layer]')).toHaveAttribute(
    'data-canvas-slide-layer',
    '2'
  );

  await section.getByRole('button', { name: 'Make default' }).click();
  await expect(section.getByTestId('canvas-transition-source')).toHaveText(
    'Deck default: Push'
  );
});
