import { expect, test } from '@playwright/test';

const fixture = '/src/features/agent-screen/browser-test/chat.html';
const KNOWN = '01a1ff9c-c73e-7c62-8c23-20a668f2f355';
const UNKNOWN = '01a1ff9c-0000-7000-8000-000000000000';
// Set to keep a PNG of each theme for review.
const shots = process.env.AGENT_SCREEN_SHOTS_DIR;

for (const theme of ['light', 'dark'] as const) {
  test(`an agent's screen link reads as a chip that opens it to watch, ${theme}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${fixture}?theme=${theme}`, { waitUntil: 'networkidle' });

    // The link the agent wrote becomes a chip named for the agent, on this
    // origin's screen route and with no request to drive.
    const chip = page.getByRole('link', { name: 'Eve’s screen' });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('href', `/app/screen/${KNOWN}`);
    await expect(page.getByText('open my screen')).toHaveCount(0);

    // A screen not in the viewer's list is still a chip, named without a guess.
    await expect(
      page.getByRole('link', { name: 'A computer’s screen' })
    ).toHaveAttribute('href', `/app/screen/${UNKNOWN}`);

    // A malformed screen link and one on another site stay plain links.
    await expect(page.getByRole('link', { name: 'broken' })).toHaveAttribute(
      'href',
      /\/app\/screen\/not-a-harness$/
    );
    await expect(
      page.getByRole('link', { name: 'other site' })
    ).toHaveAttribute('href', `https://example.com/app/screen/${KNOWN}`);
    await expect(page.locator('[data-screen-chip]')).toHaveCount(2);

    if (shots) {
      await page
        .getByTestId('message')
        .screenshot({ path: `${shots}/chat-chip-${theme}.png` });
    }

    // A click opens the screen in the app (to watch), without leaving the page.
    await chip.click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as { openedScreens?: string[] }).openedScreens
        )
      )
      .toEqual([KNOWN]);
    expect(page.url()).toContain(fixture);
    expect(errors).toEqual([]);
  });
}
