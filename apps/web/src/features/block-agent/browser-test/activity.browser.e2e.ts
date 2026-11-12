import { expect, test } from '@playwright/test';

type Seen = {
  /** The most live lines on screen at once. */
  lines: number;
  /** The most shimmering labels on screen at once. */
  shimmers: number;
  /** Whether a run's calls showed without anyone opening them. */
  opened: boolean;
  /** Everything the live line said. */
  said: string[];
};

declare global {
  interface Window {
    seen: Seen;
  }
}

test('a long run of calls and thoughts is one live line, then one settled row', async ({
  page,
}) => {
  // The replay runs about 16 seconds after the dev server's first load.
  test.setTimeout(120_000);
  // Watch every frame of the turn for what the reader sees while it runs.
  await page.addInitScript(() => {
    const seen: Seen = { lines: 0, shimmers: 0, opened: false, said: [] };
    window.seen = seen;
    const sample = () => {
      const session = document.querySelector('[aria-label="Agent session"]');
      if (session) {
        const lines = session.querySelectorAll('[role="status"]');
        seen.lines = Math.max(seen.lines, lines.length);
        const shimmers = [
          ...session.querySelectorAll('.magic-chip-shimmer'),
        ].filter((element) => !element.classList.contains('opacity-0'));
        seen.shimmers = Math.max(seen.shimmers, shimmers.length);
        if (session.querySelector('[role="region"][aria-label="Tool calls"]'))
          seen.opened = true;
        for (const line of lines) {
          // The shimmer paints its text twice; its label says it once.
          const text = line
            .querySelector('[aria-label]')
            ?.getAttribute('aria-label');
          if (text && !seen.said.includes(text)) seen.said.push(text);
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto('/activity.html?speed=4');
  const session = page.getByRole('region', { name: 'Agent session' });
  // The dev server transforms the app's modules on first load.
  await expect(session.getByRole('status')).toBeVisible({ timeout: 30_000 });
  await expect(session.locator('[data-turn="done"]')).toBeAttached({
    timeout: 60_000,
  });

  const seen = await page.evaluate(() => window.seen);
  expect(seen.lines).toBe(1);
  expect(seen.shimmers).toBe(1);
  expect(seen.opened).toBe(false);
  // The line moved through the run's steps and its thoughts.
  expect(seen.said).toContain('Thinking');
  expect(seen.said).toContain('Searching documents hosting invoice');
  expect(seen.said.length).toBeGreaterThan(5);

  // Settled: each run is one row, with the long run's failures counted.
  await expect(session.getByRole('status')).toHaveCount(0);
  const runs = session.getByRole('button', { name: /^Used \d+ tools?/ });
  await expect(runs).toHaveCount(2);
  await expect(runs.nth(0)).toHaveText('Used 1 tool');
  await expect(runs.nth(1)).toHaveText('Used 74 tools · 2 failed');
  await expect(session.getByText('nothing has been sent')).toBeVisible();

  // Opening the long run lists every step in full, the timed out one too.
  await runs.nth(1).click();
  const calls = session.getByRole('region', { name: 'Tool calls' });
  await expect(calls).toBeVisible();
  await expect(calls.getByText('Timed out')).toBeVisible();
  await expect(calls.getByLabel('Update a draft failed')).toBeVisible();
  // Once it has opened, nothing is cut off behind a scroll.
  await expect
    .poll(() =>
      calls.evaluate((element) => element.scrollHeight - element.clientHeight)
    )
    .toBeLessThanOrEqual(1);
  expect((await calls.boundingBox())?.height).toBeGreaterThan(600);
});
