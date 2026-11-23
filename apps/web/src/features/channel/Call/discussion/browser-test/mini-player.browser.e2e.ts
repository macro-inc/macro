import { expect, test } from '@playwright/test';

const PATH =
  '/src/features/channel/Call/discussion/browser-test/call-overlay.html';
const FIRST = 'macro|member@example.com';
const SECOND = 'macro|member2@example.com';

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'The floating player is desktop-only.'
  );
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const staticResource = [
      'document',
      'script',
      'stylesheet',
      'font',
      'image',
    ].includes(request.resourceType());
    if (
      url.hostname === 'localhost' &&
      staticResource &&
      !url.pathname.startsWith('/__macro_dev/')
    ) {
      await route.continue();
    } else {
      // No service traffic leaves the synthetic call fixture.
      await route.fulfill({ status: 404, json: {} });
    }
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
});

for (const layout of ['auto', 'grid', 'speaker', 'sidebar']) {
  test(`mini-player keeps the stage pin across navigation in ${layout}`, async ({
    page,
  }, testInfo) => {
    await page.goto(
      `${PATH}?miniPlayerFocus=true&media=on&count=3&chat=off&work=off&layout=${layout}`
    );
    await page
      .getByRole('button', { name: 'Pin Participant 1', exact: true })
      .first()
      .click();
    await page.clock.install();
    await page.evaluate(
      (identity) =>
        window.dispatchEvent(
          new CustomEvent('fixture-speaker', { detail: identity })
        ),
      SECOND
    );
    await page
      .getByRole('button', { name: 'Leave call view', exact: true })
      .click();
    const preview = page.locator('[data-call-player-participant]');
    await expect(preview).toHaveAttribute(
      'data-call-player-participant',
      FIRST
    );
    await page.clock.runFor(1000);
    await expect(preview).toHaveAttribute(
      'data-call-player-participant',
      FIRST
    );
    await expect(
      preview.locator('[data-fixture-track="Participant 1"]')
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`pinned-${layout}.png`),
    });

    await page
      .getByRole('button', { name: 'Return to call', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Unpin Participant 1', exact: true })
      .first()
      .click();
    await page
      .getByRole('button', { name: 'Leave call view', exact: true })
      .click();
    await expect(preview).toHaveAttribute(
      'data-call-player-participant',
      SECOND
    );
  });
}

test('mini-player distinguishes a pinned camera from a pinned shared screen', async ({
  page,
}, testInfo) => {
  await page.goto(
    `${PATH}?miniPlayerFocus=true&media=on&count=3&chat=off&work=off&share=remote-pair`
  );
  await page
    .getByRole('button', { name: 'Pin Participant 2', exact: true })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Leave call view', exact: true })
    .click();
  const preview = page.locator('[data-call-player-participant]');
  await expect(preview).toHaveAttribute('data-call-player-participant', SECOND);
  await expect(
    preview.locator('[data-fixture-track="Participant 2"]')
  ).toBeVisible();
  await expect(
    preview.locator('[data-fixture-track="Shared screen 2"]')
  ).toHaveCount(0);

  await page
    .getByRole('button', { name: 'Return to call', exact: true })
    .click();
  await page
    .getByRole('button', { name: "Pin Participant 2's screen", exact: true })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Leave call view', exact: true })
    .click();
  await expect(preview).toHaveAttribute('data-call-player-participant', SECOND);
  await expect(
    preview.locator('[data-fixture-track="Shared screen 2"]')
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('pinned-share.png') });
});
