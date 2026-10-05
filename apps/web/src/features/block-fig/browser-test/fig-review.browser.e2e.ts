import { expect, type Page, test } from '@playwright/test';

// The engine's prototype fixture (crates/fig_engine/src/testing/prototype.rs):
// page "Flow" holds "Start" (1:10, the flow "Onboarding"; "Next" 1:11 goes
// to Details with a dissolve, "Open menu" 1:12 opens the Menu overlay),
// "Details" (1:20; "Back" 1:21, "Finish" 1:22 slides to Done), "Menu"
// (1:30, an overlay that closes on a click outside; "Close" 1:31), "Done"
// (1:40; "Site" links out, "Restart" 1:42 goes back to Start through the
// legacy fields), and "Unlinked" (1:50). Frames are 320×480 (Menu
// 240×300); buttons are 120×40.
const PROTOTYPE = 'prototype.fig';

async function open(page: Page, query = '') {
  await page.goto(`/?file=${encodeURIComponent(PROTOTYPE)}${query}`);
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  await expect(page.getByTestId('fig-layer-row').first()).toBeVisible();
}

/** Clicks a point of the presented screen, in frame coordinates. */
async function clickScreen(page: Page, x: number, y: number) {
  const screen = page.getByTestId('fig-present-screen');
  await expect(screen).toHaveAttribute('data-loaded', 'true');
  const box = await screen.boundingBox();
  if (!box) throw new Error('No screen');
  const scale = box.width / 320;
  await page.mouse.click(box.x + x * scale, box.y + y * scale);
}

async function presented(page: Page, frame: string) {
  await expect(page.getByTestId('fig-present-screen')).toHaveAttribute(
    'data-frame',
    frame
  );
  // The transition has finished.
  await expect(page.getByTestId('fig-present-leaving')).toHaveCount(0);
}

/** Selects a layer through the layer search. */
async function select(page: Page, name: string) {
  if (!(await page.getByTestId('fig-layer-search').isVisible()))
    await page.getByTestId('fig-search-toggle').click();
  await page.getByTestId('fig-layer-search').fill(name);
  await page
    .getByTestId('fig-search-hit')
    .filter({ hasText: name })
    .first()
    .click();
  await page.getByTestId('fig-layer-search').fill('');
}

test('presents the flow, steps with the keys, and copies a frame link', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await page.getByTestId('fig-present-button').click();
  await expect(page.getByTestId('fig-present')).toBeVisible();
  await presented(page, '1:10');
  await expect(page.getByTestId('fig-present-name')).toHaveText('Start');
  await expect(page.getByTestId('fig-present-flow')).toHaveText('Onboarding');
  // The flow reaches Start, Details, and Done (Menu is an overlay).
  await expect(page.getByTestId('fig-present-index')).toHaveText('1 / 3');
  await page.keyboard.press('ArrowRight');
  await presented(page, '1:20');
  await expect(page.getByTestId('fig-present-index')).toHaveText('2 / 3');
  await page.keyboard.press('Space');
  await presented(page, '1:40');
  await page.keyboard.press('ArrowRight');
  await presented(page, '1:10');
  await page.keyboard.press('ArrowLeft');
  await presented(page, '1:40');
  // Rendered at the size it is shown: the screen is scaled to fit.
  const box = await page.getByTestId('fig-present-screen').boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.height).toBeGreaterThan(
    (viewport?.height ?? 0) * 0.7
  );

  await page.getByTestId('fig-present-copy-link').click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(link).searchParams.get('present')).toBe('1:40');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fig-present')).toHaveCount(0);

  // The link opens the design presenting that frame.
  await page.goto(link);
  await presented(page, '1:40');
  await expect(page.getByTestId('fig-present-name')).toHaveText('Done');
});

test('presents the selected frame', async ({ page }) => {
  await open(page);
  await select(page, 'Unlinked');
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+Alt+Enter' : 'Control+Alt+Enter'
  );
  await presented(page, '1:50');
  // Outside any flow, every screen is in page order.
  await expect(page.getByTestId('fig-present-index')).toHaveText('5 / 5');
  await page.getByTestId('fig-present-exit').click();
  await expect(page.getByTestId('fig-present')).toHaveCount(0);
});

test('clicks through the prototype: navigate, overlays, back, links', async ({
  page,
  context,
}) => {
  // The link's page, without the network.
  await context.route('https://example.com/**', (route) =>
    route.fulfill({ body: 'linked', contentType: 'text/plain' })
  );
  await open(page);
  await page.getByTestId('fig-present-button').click();
  await presented(page, '1:10');
  // Next → Details, dissolving.
  await clickScreen(page, 160, 420);
  await presented(page, '1:20');
  // A click on nothing flashes the screen's hotspots.
  await clickScreen(page, 160, 240);
  await expect(page.getByTestId('fig-present-hint')).toHaveCount(2);
  await expect(page.getByTestId('fig-present-hint')).toHaveCount(0, {
    timeout: 3000,
  });
  // Back returns to Start.
  await clickScreen(page, 80, 40);
  await presented(page, '1:10');
  // Open menu → the overlay, centered; a click outside closes it.
  await clickScreen(page, 80, 40);
  const overlay = page.getByTestId('fig-present-overlay');
  await expect(overlay).toHaveAttribute('data-frame', '1:30');
  await expect(overlay).toHaveAttribute('data-loaded', 'true');
  await clickScreen(page, 10, 470);
  await expect(overlay).toHaveCount(0);
  // Again, closed with its own Close button (at 60,240 in the menu, which
  // sits at 40,90 on the screen).
  await clickScreen(page, 80, 40);
  await expect(overlay).toHaveCount(1);
  await clickScreen(page, 40 + 120, 90 + 260);
  await expect(overlay).toHaveCount(0);
  // Next, Finish (a slide) → Done; its link opens a new tab.
  await clickScreen(page, 160, 420);
  await presented(page, '1:20');
  await clickScreen(page, 160, 420);
  await presented(page, '1:40');
  const popup = page.waitForEvent('popup');
  await clickScreen(page, 160, 420);
  expect((await popup).url()).toContain('example.com');
  // Restart: a connection kept in the legacy fields.
  await clickScreen(page, 160, 40);
  await presented(page, '1:10');
});

test('edits interactions and flows in the Prototype tab and saves them', async ({
  page,
}) => {
  await open(page, '&edit');
  await select(page, 'Next');
  await page.getByTestId('fig-panel-tab-prototype').click();
  const panel = page.getByTestId('fig-prototype-panel');
  await expect(panel.getByTestId('fig-proto-interaction')).toHaveCount(1);
  await panel.getByTestId('fig-proto-open').click();
  await expect(page.getByTestId('fig-proto-destination')).toHaveText('Details');
  await expect(page.getByTestId('fig-proto-transition')).toHaveText('Dissolve');
  // The selection's connection is drawn on the canvas.
  await expect(
    page.locator('[data-testid="fig-noodle"][data-from="1:11"]')
  ).toHaveAttribute('data-to', '1:20');
  await expect(page.getByTestId('fig-flow-badge')).toHaveText(/Onboarding/);

  await page.getByTestId('fig-proto-destination').click();
  await page.getByRole('option', { name: 'Done', exact: true }).click();
  await expect(
    page.locator('[data-testid="fig-noodle"][data-from="1:11"]')
  ).toHaveAttribute('data-to', '1:40');
  await page.getByTestId('fig-proto-transition').click();
  await page.getByRole('option', { name: 'Push', exact: true }).click();
  await page.getByTestId('fig-proto-duration').fill('450');
  await page.getByTestId('fig-proto-duration').press('Enter');
  await page
    .getByRole('button', { name: 'Close interaction settings' })
    .click();
  // A second interaction: open the menu as an overlay.
  await panel.getByTestId('fig-proto-add').click();
  await expect(panel.getByTestId('fig-proto-interaction')).toHaveCount(2);
  await page.getByTestId('fig-proto-action').click();
  await page.getByRole('option', { name: 'Open overlay', exact: true }).click();
  await page.getByTestId('fig-proto-destination').click();
  await page.getByRole('option', { name: 'Menu', exact: true }).click();

  const proto = () =>
    page.evaluate(async () => {
      const info = await window.figFixture.engine()?.prototype(0);
      return info?.hotspots.find((h) => h.id === '1:11')?.interactions;
    });
  await expect
    .poll(async () => (await proto())?.map((i) => i.actions[0]))
    .toMatchObject([
      {
        destination: '1:40',
        transition: 'PUSH_FROM_RIGHT',
        duration: 0.45,
        easing: 'OUT_CUBIC',
      },
      { navigation: 'OVERLAY', destination: '1:30' },
    ]);

  await page
    .getByRole('button', { name: 'Close interaction settings' })
    .click();
  // A flow starting point on another frame.
  await select(page, 'Unlinked');
  await panel.getByTestId('fig-flow-add').click();
  await expect(panel.getByTestId('fig-flow-name')).toHaveValue('Flow 2');
  await expect(panel.getByTestId('fig-flow')).toHaveCount(2);

  // Removing the added interaction, then undo brings it back.
  await select(page, 'Next');
  await panel.getByTestId('fig-proto-remove').nth(1).click();
  await expect(panel.getByTestId('fig-proto-interaction')).toHaveCount(1);
  await page.getByTestId('fig-main-menu').click();
  await page.getByTestId('fig-main-edit').hover();
  await page.getByTestId('fig-undo').click();
  await expect(panel.getByTestId('fig-proto-interaction')).toHaveCount(2);

  // Saved (and the save reopens: `?reload` is off, so reopen it here).
  await expect(page.getByTestId('fig-save-state')).toHaveAttribute(
    'data-state',
    'saved',
    { timeout: 10_000 }
  );
  await expect
    .poll(() => page.evaluate(() => window.figFixture.saves().length))
    .toBeGreaterThan(0);

  // Presenting (from the selection's frame) plays the edited connection.
  await page.getByTestId('fig-present-button').click();
  await presented(page, '1:10');
  await clickScreen(page, 160, 420);
  await presented(page, '1:40');
});

test('comments: pins, replies, mentions, unread, resolve, and moving with the frame', async ({
  page,
}) => {
  await open(page, '&edit');
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('c');
  await expect(page.getByTestId('fig-tool-comment')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const panel = page.getByTestId('fig-comments-panel');
  await expect(panel.getByTestId('fig-comments-empty')).toBeVisible();

  // Fit the page, then comment in the middle of Start.
  await page.keyboard.press('Shift+1');
  const start = await page.evaluate(async () => {
    const [g] = (await window.figFixture.engine()?.geometry(0, ['1:10'])) ?? [];
    return g?.bounds;
  });
  expect(start).toBeTruthy();
  const canvas = page.getByTestId('fig-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('No canvas');
  // Start is the left-most frame of the fitted page.
  await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.3);
  const input = page.getByTestId('fig-comment-input');
  await expect(input).toBeFocused();
  await input.pressSequentially('Please check @Bl');
  await expect(page.getByTestId('fig-mention-option')).toHaveText([
    'Blair Chen',
  ]);
  await page.keyboard.press('Enter');
  await input.pressSequentially('thanks');
  await page.keyboard.press('Enter');

  const pin = page.getByTestId('fig-comment-pin');
  await expect(pin).toHaveCount(1);
  const popover = page.getByTestId('fig-comment-popover');
  await expect(popover.getByTestId('fig-comment-mention')).toHaveText(
    '@Blair Chen'
  );
  const thread = await page.evaluate(
    () =>
      window.figFixture.comments.threads()[0] as {
        id: string;
        anchor: { nodeId: string };
      }
  );
  expect(thread.anchor.nodeId).toBe('1:10');
  expect(
    await page.evaluate(() => window.figFixture.comments.notified())
  ).toEqual([{ to: 'user-blair', threadId: thread.id }]);

  // A reply.
  await popover.getByTestId('fig-comment-reply').fill('One more thing');
  await popover.getByTestId('fig-comment-reply-post').click();
  await expect(popover.getByTestId('fig-comment-item')).toHaveCount(2);
  await expect(panel.getByTestId('fig-comment-row')).toContainText('1 reply');

  // Someone else replies: the thread is unread until opened.
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await page.evaluate((id) => {
    const f = window.figFixture.comments;
    f.arrive(f.people[1], 'Done!', { threadId: id });
  }, thread.id);
  await expect(page.getByTestId('fig-comments-unread')).toHaveText('1');
  await expect(pin).toHaveAttribute('data-unread', 'true');
  await panel.getByTestId('fig-comment-row').click();
  await expect(popover).toBeVisible();
  await expect(pin).toHaveAttribute('data-unread', 'false');
  await expect(page.getByTestId('fig-comments-unread')).toHaveCount(0);

  // Resolve: it leaves the Open list and shows under Resolved.
  await popover.getByTestId('fig-comment-resolve').click();
  await page.keyboard.press('Escape');
  await expect(pin).toHaveCount(0);
  await expect(panel.getByTestId('fig-comment-row')).toHaveCount(0);
  await panel.getByTestId('fig-comments-filter').click();
  await page.getByTestId('fig-comments-filter-resolved').click();
  await expect(panel.getByTestId('fig-comment-row')).toHaveCount(1);
  await panel.getByTestId('fig-comment-row').click();
  await popover.getByTestId('fig-comment-reopen').click();
  await panel.getByTestId('fig-comments-filter').click();
  await page.getByTestId('fig-comments-filter-open').click();
  await expect(panel.getByTestId('fig-comment-row')).toHaveCount(1);

  // The pin moves with its frame.
  const before = await pin.boundingBox();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fig-comments-panel')).toHaveCount(0);
  await select(page, 'Start');
  const x = page.getByTestId('fig-field-x');
  await x.fill('-200');
  await x.press('Enter');
  await page.getByTestId('fig-tool-comment').click();
  expect(before).toBeTruthy();
  // The frame moved left by 200 page units; the pin follows.
  await expect
    .poll(async () => (before?.x ?? 0) - ((await pin.boundingBox())?.x ?? 0))
    .toBeGreaterThan(20);
  const after = await pin.boundingBox();
  expect(Math.abs((before?.y ?? 0) - (after?.y ?? 0))).toBeLessThan(2);
});
