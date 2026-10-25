import { expect, test } from '@playwright/test';

test('previews expose text once, route clicks to their row, and skip embedded controls', async ({
  page,
  context,
}, testInfo) => {
  // Render production components over synthetic props; no hosted data is read or written.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === 'localhost' &&
      !url.pathname.includes('/__macro_dev/')
    ) {
      await route.continue();
    } else {
      await route.fulfill({
        status:
          url.hostname === 'example.com' || url.pathname.includes('unfurl')
            ? 200
            : 401,
        contentType: 'application/json',
        body: JSON.stringify({ responses: [] }),
      });
    }
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/component/core/browser-test/preview.html'
  );
  const text = 'Read Roadmap with Alex';
  let openCount = 0;
  const cdp = await context.newCDPSession(page);
  const layouts =
    testInfo.project.name === 'mobile'
      ? ['narrow', 'channel', 'message', 'thread']
      : ['wide', 'narrow', 'channel', 'message', 'thread'];
  for (const id of layouts) {
    const row = page.getByTestId(id).getByRole('button').first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    // Read Chromium's accessibility tree: DOM-based role queries don't model inert.
    const cdpDocument = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: cdpDocument.root.nodeId,
      selector: `[data-testid="${id}"] [role="button"]`,
    });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
      nodeId,
      fetchRelatives: false,
    });
    const accessibleName = nodes[0].name?.value ?? '';
    expect(accessibleName.split(text).length - 1).toBe(id === 'thread' ? 2 : 1);
    expect(accessibleName).not.toContain('<m-');
    const accessibility = await cdp.send('Accessibility.getFullAXTree');
    expect(
      accessibility.nodes.filter(
        (node) =>
          !node.ignored &&
          node.role?.value === 'link' &&
          node.name?.value === 'Roadmap'
      )
    ).toHaveLength(1);
    const previews = page.getByTestId(id).locator('.markdown-content');
    for (const preview of await previews.all()) {
      for (const target of [
        preview.locator('a'),
        preview.locator('[data-user-mention]'),
      ]) {
        await target.scrollIntoViewIfNeeded();
        const bounds = await target.boundingBox();
        expect(bounds).not.toBeNull();
        if (!bounds) throw new Error('Preview target has no bounds');
        if (testInfo.project.use.hasTouch) {
          await page.touchscreen.tap(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2
          );
        } else {
          await page.mouse.click(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2
          );
        }
        openCount += 1;
        await expect(page.getByRole('status')).toHaveText(
          `Opened: ${id} (${openCount})`
        );
        expect(context.pages()).toHaveLength(1);
      }
    }
    await row.focus();
    await page.keyboard.press('Tab');
    expect(
      await page
        .getByTestId(id)
        .evaluate((el) => el.contains(document.activeElement))
    ).toBe(false);
  }
  const conversation = page.getByTestId('conversation');
  const link = conversation.getByRole('link', { name: 'Roadmap' });
  await expect(link).toBeVisible();
  await link.focus();
  await expect(link).toBeFocused();
  const popupPromise = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  const popup = await popupPromise;
  await expect(popup).toHaveURL('https://example.com/roadmap');
  await popup.close();
  await link.focus();
  await page.keyboard.press('Tab');
  expect(
    await conversation
      .locator('[data-user-mention]')
      .evaluate((element) => document.activeElement?.contains(element))
  ).toBe(true);
  // Reset horizontal scroll caused by revealing clipped preview targets.
  await page.locator('*').evaluateAll((elements) => {
    for (const element of elements) element.scrollLeft = 0;
  });
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('previews.png'),
    fullPage: true,
  });
});
