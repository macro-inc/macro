import { expect, type Page, test } from '@playwright/test';

test.setTimeout(60_000);

/** The services answer after 400 ms; see `session-switch-services.ts`. */
const SERVER_MS = 400;

type Switch = { id: string; ms: number };

async function open(page: Page, id: string, restMs: number): Promise<number> {
  const row = page.getByRole('button', { name: `Session ${id}` });
  const box = await row.boundingBox();
  if (!box) throw new Error(`row ${id} is not on screen`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  if (restMs > 0) await page.waitForTimeout(restMs);
  await page.mouse.down();
  await page.mouse.up();
  await expect(
    page
      .getByRole('region', { name: 'Transcript' })
      .getByText(`Transcript of ${id}`)
  ).toBeVisible();
  const switches = await page.evaluate(
    () => (window as unknown as { switches: Switch[] }).switches
  );
  const shown = switches.findLast((entry) => entry.id === id);
  if (!shown) throw new Error(`no transcript recorded for ${id}`);
  return shown.ms;
}

const readsOf = (page: Page) =>
  page.evaluate(() => {
    const { reads } = window as unknown as {
      reads: { rows: Map<string, number>; logs: Map<string, number> };
    };
    return {
      rows: Object.fromEntries(reads.rows),
      logs: Object.fromEntries(reads.logs),
    };
  });

test('a session the pointer rested on opens without waiting out the fetch', async ({
  page,
}) => {
  await page.goto('/session-switch.html');
  await expect(
    page.getByRole('button', { name: 'Session alpha' })
  ).toBeVisible();

  // Pressed the moment the pointer arrives: the whole fetch is waited out.
  const pressed = await open(page, 'alpha', 0);
  // The pointer rests on the row first, as it does before a deliberate press.
  const rested = await open(page, 'beta', 300);
  // Back to one already opened: held, so nothing is fetched at all.
  const back = await open(page, 'alpha', 0);

  console.log(
    `session switch: pressed at once ${pressed} ms, after a 300 ms rest ${rested} ms, back to a held one ${back} ms`
  );
  expect(pressed).toBeGreaterThanOrEqual(SERVER_MS);
  expect(rested).toBeLessThan(pressed - 200);
  expect(back).toBeLessThan(100);
  // One log read per session, whoever started it. The held session's row is
  // read again behind its transcript, as it may be hours old.
  expect(await readsOf(page)).toEqual({
    rows: { alpha: 2, beta: 1 },
    logs: { alpha: 1, beta: 1 },
  });
});

test('passing over rows on the way somewhere else opens none of them', async ({
  page,
}) => {
  await page.goto('/session-switch.html');
  const first = await page
    .getByRole('button', { name: 'Session alpha' })
    .boundingBox();
  const last = await page
    .getByRole('button', { name: 'Session gamma' })
    .boundingBox();
  if (!first || !last) throw new Error('rows are not on screen');
  await page.mouse.move(first.x + 20, first.y + first.height / 2);
  await page.mouse.move(last.x + 20, last.y + last.height + 40, { steps: 4 });
  await page.waitForTimeout(500);

  expect(await readsOf(page)).toEqual({ rows: {}, logs: {} });
});
