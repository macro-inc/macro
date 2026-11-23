import { readFileSync } from 'node:fs';
import {
  type BrowserContext,
  type BrowserContextOptions,
  test as base,
  type Page,
} from '@playwright/test';
import { Api } from './api';
import { type History, readHistory } from './history';
import {
  apiFor,
  type Person,
  type PersonKey,
  readPeople,
  sessionFile,
} from './people';

type Session = NonNullable<
  Exclude<BrowserContextOptions['storageState'], string>
>;

function session(key: PersonKey): Session {
  return JSON.parse(readFileSync(sessionFile(key), 'utf8')) as Session;
}

/**
 * What a context a test opens itself needs so that its pages are recorded
 * when the run records video. Playwright records only the contexts it opens.
 */
export function recorded(): Pick<BrowserContextOptions, 'recordVideo'> {
  if (!process.env.CHANNELS_E2E_VIDEO) return {};
  return { recordVideo: { dir: base.info().outputPath('videos') } };
}

/** Closes a context opened with `recorded()` and keeps its pages' videos. */
export async function closeRecorded(context: BrowserContext): Promise<void> {
  const pages = context.pages();
  await context.close();
  for (const page of pages) {
    const path = await page.video()?.path();
    if (path) {
      await base.info().attach('video', { path, contentType: 'video/webm' });
    }
  }
}

type Fixtures = {
  people: Record<PersonKey, Person>;
  /** Ada's session with the services. The default page is hers too. */
  ada: Api;
  ben: Api;
  cy: Api;
  dee: Api;
  /** A page of the app for another person, in a browser profile of their own. */
  pageFor: (key: PersonKey) => Promise<Page>;
};

function api(key: PersonKey) {
  return async (
    { people }: { people: Record<PersonKey, Person> },
    use: (api: Api) => Promise<void>
  ) => {
    const http = await apiFor(key);
    await use(new Api(people[key], http));
    await http.dispose();
  };
}

type WorkerFixtures = {
  /** The long, read-only channel, made before the run's first test. */
  history: History;
};

export const test = base.extend<Fixtures, WorkerFixtures>({
  history: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads what a fixture needs from this pattern and accepts nothing else here.
    async ({}, use) => {
      await use(readHistory());
    },
    { scope: 'worker' },
  ],
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads what a fixture needs from this pattern and accepts nothing else here.
  people: async ({}, use) => {
    await use(readPeople());
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads what a fixture needs from this pattern and accepts nothing else here.
  storageState: async ({}, use) => {
    await use(session('ada'));
  },
  ada: api('ada'),
  ben: api('ben'),
  cy: api('cy'),
  dee: api('dee'),
  pageFor: async ({ browser }, use) => {
    const opened: BrowserContext[] = [];
    await use(async (key) => {
      const context = await browser.newContext({
        storageState: session(key),
        ...recorded(),
      });
      opened.push(context);
      return context.newPage();
    });
    for (const context of opened) {
      await closeRecorded(context);
    }
  },
});

export { expect } from '@playwright/test';

/**
 * Runs a check that a known product defect fails only some of the time, so
 * that `test.fail()` cannot mark it. A failure is recorded on the test, where
 * `ledger/check.ts --report` counts it, and the test goes on. Only for a test
 * listed in `ledger/intermittent-defects.tsv`.
 */
export async function failsSometimes(
  check: () => Promise<void>
): Promise<void> {
  try {
    await check();
  } catch (error) {
    test.info().annotations.push({
      type: 'intermittent-defect',
      description: String(error).split('\n')[0],
    });
  }
}

/**
 * Whether the app under test was built with `VITE_ENABLE_CHANNEL_LOCAL_SYNC=true`,
 * which the page cannot show. A run against an app built with it must set it
 * too; `run-with-bundle.sh` gives it to the build and the run alike.
 */
export const LOCAL_SYNC_BUILD =
  process.env.VITE_ENABLE_CHANNEL_LOCAL_SYNC === 'true';

/**
 * Marks the test as one a known product defect fails in every run, on the
 * builds named: without the flag, with it, or both. The test is listed in
 * `ledger/known-defects.tsv` with the same builds.
 */
export function knownDefect(builds: 'off' | 'on' | 'both'): void {
  test.fail(builds === 'both' || (builds === 'on') === LOCAL_SYNC_BUILD);
}
