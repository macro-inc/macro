import { expect, type Page, test } from '@playwright/test';

type Seen = {
  /** The most working indicators on screen at once. */
  lines: number;
  /** The most shimmering labels on screen at once. */
  shimmers: number;
  /** Frames where the agent was working and nothing on screen said so. */
  dark: number;
  /** Whether a run's calls showed without anyone opening them. */
  opened: boolean;
  /** Everything the working indicator said. */
  said: string[];
};

declare global {
  interface Window {
    seen: Seen;
  }
}

/** Plays the replay and watches every frame of the turn. */
async function playTurn(page: Page, query: string) {
  await page.addInitScript(() => {
    const seen: Seen = {
      lines: 0,
      shimmers: 0,
      dark: 0,
      opened: false,
      said: [],
    };
    window.seen = seen;
    const sample = () => {
      const session = document.querySelector('[aria-label="Agent session"]');
      const turn = session?.querySelector<HTMLElement>('[data-turn]');
      if (session && turn?.dataset.turn === 'live') {
        // Each working indicator leads with the working dots.
        const lines = [...session.querySelectorAll('.agent-working-twirl')];
        seen.lines = Math.max(seen.lines, lines.length);
        // Streaming prose shows the turn is alive on its own.
        if (lines.length === 0 && turn.dataset.tail !== 'text') seen.dark += 1;
        const shimmers = [
          ...session.querySelectorAll('.magic-chip-shimmer'),
        ].filter((element) => !element.classList.contains('opacity-0'));
        seen.shimmers = Math.max(seen.shimmers, shimmers.length);
        if (session.querySelector('[role="region"][aria-label="Tool calls"]'))
          seen.opened = true;
        for (const line of lines) {
          // The shimmer paints its text twice; its label says it once.
          const text = line.parentElement
            ?.querySelector('[aria-label]')
            ?.getAttribute('aria-label');
          if (text && !seen.said.includes(text)) seen.said.push(text);
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto(`/activity.html?${query}`);
  const session = page.getByRole('region', { name: 'Agent session' });
  // The dev server transforms the app's modules on first load.
  await expect(session.locator('.agent-working-twirl')).toBeVisible({
    timeout: 30_000,
  });
  await expect(session.locator('[data-turn="done"]')).toBeAttached({
    timeout: 60_000,
  });
  const seen = await page.evaluate(() => window.seen);
  // One thing working at a time, and never nothing while the agent works.
  expect(seen.lines).toBe(1);
  expect(seen.shimmers).toBe(1);
  expect(seen.dark).toBe(0);
  expect(seen.opened).toBe(false);
  return { session, seen };
}

test('a long run of calls and thoughts is one live line, then one settled row', async ({
  page,
}) => {
  // The replay runs about 20 seconds after the dev server's first load.
  test.setTimeout(120_000);
  const { session, seen } = await playTurn(page, 'speed=4');
  // The line moved through the run's steps: a thought, a direct call, and
  // a program operation the record poll saw running.
  expect(seen.said).toContain('Thinking');
  expect(seen.said).toContain('Searching documents hosting invoice');
  expect(seen.said).toContain('Read spreadsheet');
  expect(seen.said.length).toBeGreaterThan(5);

  // Settled: each run is one row, with the long run's failures counted.
  await expect(session.locator('.agent-working-twirl')).toHaveCount(0);
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
  await expect(calls.getByLabel('Update draft', { exact: true })).toBeVisible();
  await expect(calls.getByText('Failed', { exact: true })).toHaveCount(1);
  // Once it has opened, nothing is cut off behind a scroll.
  await expect
    .poll(() =>
      calls.evaluate((element) => element.scrollHeight - element.clientHeight)
    )
    .toBeLessThanOrEqual(1);
  expect((await calls.boundingBox())?.height).toBeGreaterThan(600);

});

test("the live line carries the session's status line when it has one", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { session, seen } = await playTurn(page, 'speed=4&summary=1');
  expect(seen.said).toContain('Reading CI usage reports…');
  expect(seen.said).toContain('Drafting the forward to Sam…');
  await expect(
    session.getByRole('button', { name: /^Used \d+ tools?/ })
  ).toHaveCount(2);
});
