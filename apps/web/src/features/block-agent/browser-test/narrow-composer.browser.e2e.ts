import { expect, test } from '@playwright/test';

// A narrow desktop window, as a split or a small browser window leaves it.
test.use({ viewport: { width: 390, height: 700 } });

test('Send stays inside a narrow composer next to a long model name', async ({
  page,
}) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) =>
    route.fulfill({ status: 404, json: [] })
  );
  await page.goto(
    '/composer.html?model=anthropic/claude-opus-5-5-extended-thinking'
  );

  await page.getByRole('textbox').first().click();
  await page.keyboard.type('Ship it');
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeEnabled();

  const composer = page.locator('[data-keep-keyboard]').first();
  const sendBox = await send.boundingBox();
  const composerBox = await composer.boundingBox();
  if (!sendBox || !composerBox)
    throw new Error('Send or composer not laid out');
  await page.screenshot({
    path: test.info().outputPath('narrow-composer.png'),
  });

  expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(
    composerBox.x + composerBox.width
  );
  await expect(send).toBeInViewport({ ratio: 1 });

  // A pointer at Send's centre reaches Send.
  const sendAtCentre = await page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest('button')
        ?.getAttribute('aria-label'),
    { x: sendBox.x + sendBox.width / 2, y: sendBox.y + sendBox.height / 2 }
  );
  expect(sendAtCentre).toBe('Send');
});
