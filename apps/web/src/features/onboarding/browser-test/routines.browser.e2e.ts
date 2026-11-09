import { expect, type Page, test } from '@playwright/test';
import type { RoutineSuggestion } from '@service-scheduled-action/generated/schemas';
import type { FakeOnboardingWorld } from '../tests/fake-onboarding-context';
import {
  expectLanded,
  fakeEvents,
  fakeWorld,
  heading,
  openFixture,
} from './fixture-page';

// Screenshots for the change's proof page, when PROOF_DIR is set.
const PROOF_DIR = process.env.PROOF_DIR;

const suggestion = (
  id: string,
  key: string,
  options: { from?: 'for_you' | 'macro'; reason?: string; on?: boolean } = {}
): RoutineSuggestion => ({
  id,
  kind: 'catalog',
  key,
  knobs: {},
  from: options.from ?? 'for_you',
  surfaces: [key === 'triage' || key === 'stuck' ? 'tasks' : 'email'],
  reason: options.reason ?? null,
  keepProbability: options.from === 'macro' ? null : 0.9,
  onByDefault: options.on ?? false,
});

const SORT = suggestion('sort', 'inbox', {
  reason: 'Most of your mail is newsletters and receipts.',
  on: true,
});
const STUCK = suggestion('stuck', 'stuck', {
  reason: 'Several threads ask you for follow-ups.',
});
const TEMPLATES = [
  suggestion('updates', 'updates', { from: 'macro' }),
  suggestion('triage', 'triage', { from: 'macro' }),
];

async function snap(page: Page, name: string) {
  if (!PROOF_DIR) return;
  await page.screenshot({
    path: `${PROOF_DIR}/${name}.png`,
    fullPage: true,
  });
}

const stream = (page: Page, patch: Partial<FakeOnboardingWorld>) =>
  page.evaluate((patch) => window.onboardingFixture.update(patch), patch);

test('the last step streams AI’s suggestions in, fills empty surfaces after the wait, and tops up once AI is done', async ({
  page,
}) => {
  await page.clock.install();
  await openFixture(page, '/?view=flow&step=routines', {
    routineSuggestionsEnabled: true,
    routineSuggestions: { status: 'generating', suggestions: TEMPLATES },
  });
  await expect(heading(page, 'Put your busywork on autopilot.')).toBeVisible();
  await expect(
    page.getByText(/Studying your workspace to suggest routines/)
  ).toBeVisible();
  // Templates wait while AI is suggesting.
  await expect(page.getByText('Share updates', { exact: true })).toHaveCount(0);
  await snap(page, 'routines-1-waiting');

  await stream(page, {
    routineSuggestions: {
      status: 'generating',
      suggestions: [SORT, ...TEMPLATES],
    },
  });
  await expect(page.getByText('Sort my inbox', { exact: true })).toBeVisible();
  await expect(
    page.getByText('For you · Most of your mail is newsletters and receipts.')
  ).toBeVisible();
  await expect(
    page.getByRole('switch', { name: 'Turn on Sort my inbox' })
  ).toBeChecked();
  await expect(page.getByText('Finding more routines for you…')).toBeVisible();
  await expect(page.getByText('Share updates', { exact: true })).toHaveCount(0);
  await snap(page, 'routines-2-arriving');

  // The wait runs out before AI is done: only Tasks, still empty, fills.
  await page.clock.fastForward(30_000);
  await expect(
    page.getByText('Triage new tasks', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('Share updates', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Finding more routines for you…')).toBeVisible();
  await snap(page, 'routines-3-filled');

  // AI keeps landing, then finishes: every surface tops up.
  await stream(page, {
    routineSuggestions: {
      status: 'generating',
      suggestions: [SORT, STUCK, ...TEMPLATES],
    },
  });
  await expect(
    page.getByText('Chase stuck tasks', { exact: true })
  ).toBeVisible();
  await stream(page, {
    routineSuggestions: {
      status: 'ready',
      suggestions: [SORT, STUCK, ...TEMPLATES],
    },
  });
  await expect(page.getByText('Share updates', { exact: true })).toBeVisible();
  await expect(page.getByText('Finding more routines for you…')).toHaveCount(0);
  await snap(page, 'routines-4-topped-up');

  // Switch inputs are visually hidden behind their track: use the keyboard.
  const stuck = page.getByRole('switch', { name: 'Turn on Chase stuck tasks' });
  await stuck.focus();
  await stuck.press('Space');
  await page.getByRole('button', { name: 'Turn on 2 routines' }).click();
  await expectLanded(page, 'Entered Macro at /home');
  expect((await fakeWorld(page)).routinesCreated).toEqual(['sort', 'stuck']);
  const events = await fakeEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({
      event: 'onboarding_v4_routines_shown',
      data: expect.objectContaining({
        shown: 2,
        for_you: 1,
        fallback: false,
        waited_out: true,
      }),
    })
  );
});

test('without an inbox the last step shows Macro’s templates at once', async ({
  page,
}) => {
  await openFixture(page, '/?view=flow&step=routines&theme=dark', {
    routineSuggestionsEnabled: true,
    routineSuggestions: { status: 'none', suggestions: TEMPLATES },
  });
  await expect(page.getByText('Share updates', { exact: true })).toBeVisible();
  await expect(page.getByText('Template from Macro')).toHaveCount(2);
  // A row opens to rename the routine before it is created.
  await page.getByRole('button', { name: /Share updates/ }).click();
  await expect(page.getByRole('textbox', { name: 'Name' })).toBeVisible();
  await snap(page, 'routines-5-templates-dark');
});

test('the last step fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page, '/?view=flow&step=routines', {
    routineSuggestionsEnabled: true,
    routineSuggestions: {
      status: 'ready',
      suggestions: [SORT, STUCK, ...TEMPLATES],
    },
  });
  await expect(page.getByText('Sort my inbox', { exact: true })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await snap(page, 'routines-6-phone');
});
