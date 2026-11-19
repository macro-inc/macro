import { expect, type Locator, type Page, test } from '@playwright/test';

const fixture = '/src/features/routines/browser-test/code.html';

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(fixture, { waitUntil: 'networkidle' });
  // The first visit pre-bundles the app's dependencies, which can take minutes.
  await expect(page.getByText('Count threads').first()).toBeVisible({
    timeout: 180_000,
  });
  return { errors };
}

/** Drags across a block as a person would, then copies what got selected. */
async function dragAndCopy(page: Page, block: Locator) {
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await block.scrollIntoViewIfNeeded();
  const box = (await block.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, {
    steps: 12,
  });
  await page.mouse.up();
  const selected = await page.evaluate(
    () => window.getSelection()?.toString() ?? ''
  );
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.keyboard.press('ControlOrMeta+C');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  return { selected, copied };
}

test('a code step’s code and its type-check problems can be selected and copied', async ({
  page,
}) => {
  const { errors } = await open(page);
  await page.getByRole('button', { name: 'Step actions' }).first().click();
  await page.getByRole('menuitem', { name: /^Show code/ }).click();

  const code = await dragAndCopy(page, page.locator('pre[aria-label="Code"]'));
  expect(code.selected).toContain('macro.email.threads.list({ limit: 5 })');
  expect(code.copied).toContain('macro.email.threads.list({ limit: 5 })');

  const problem = await dragAndCopy(
    page,
    page.getByRole('alert').first().locator('pre')
  );
  expect(problem.selected).toContain('TS2339');
  expect(problem.copied).toContain('TS2339');
  expect(errors).toEqual([]);
});

test('a rewritten step’s code changes and problems can be selected and copied', async ({
  page,
}) => {
  const { errors } = await open(page);
  const rewritten = page.getByRole('region', { name: 'Rewritten step' });
  await rewritten.getByRole('button', { name: 'Show code changes' }).click();

  const changes = await dragAndCopy(
    page,
    rewritten.locator('pre[aria-label="Code changes"]')
  );
  expect(changes.selected).toContain('limit: 10');
  expect(changes.copied).toContain('limit: 10');

  const problem = await dragAndCopy(
    page,
    rewritten.getByRole('alert').locator('pre')
  );
  expect(problem.copied).toContain('TS2339');
  expect(errors).toEqual([]);
});

test('a paused routine’s proposed update can be selected and copied', async ({
  page,
}) => {
  const { errors } = await open(page);
  const notice = page.getByRole('region', { name: 'Code update needed' });
  await notice.getByRole('button', { name: 'Review the update' }).click();

  for (const [label, line] of [
    ['Before', 'limit: 5'],
    ['Proposed', 'limit: 10'],
  ]) {
    const block = notice
      .locator('figure')
      .filter({ has: page.getByText(label, { exact: true }) })
      .locator('pre');
    const { selected, copied } = await dragAndCopy(page, block);
    expect(selected).toContain(line);
    expect(copied).toContain(line);
  }
  expect(errors).toEqual([]);
});

test('a run’s step output can be selected and copied', async ({ page }) => {
  const { errors } = await open(page);
  const run = page.getByRole('region', { name: 'Run details' });
  await run.getByRole('button', { name: 'Show output' }).click();

  const output = await dragAndCopy(page, run.locator('pre'));
  expect(output.selected).toContain('"newest": "Quarterly invoice"');
  expect(output.copied).toContain('"newest": "Quarterly invoice"');
  expect(errors).toEqual([]);
});
