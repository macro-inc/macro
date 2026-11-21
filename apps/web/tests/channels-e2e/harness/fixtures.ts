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
 * Marks the test as one a known product defect fails in every run. The test
 * is listed in `ledger/known-defects.tsv`.
 */
export function knownDefect(): void {
  test.fail();
}

/**
 * A check that an open page shows, without a reload, what someone else just
 * did. A known defect on main sometimes keeps a live change off an open page;
 * the tests it has been seen in are listed in
 * `ledger/intermittent-defects.tsv`. When the check fails, the failure is
 * recorded as `failsSometimes` records it, the page is reloaded, and the
 * check must then hold: the change is stored and shown, only not live.
 */
export async function arrivesLive(
  view: { page: Page; shown(): Promise<void> },
  check: () => Promise<void>
): Promise<void> {
  let missed = false;
  await failsSometimes(async () => {
    try {
      await check();
    } catch (error) {
      missed = true;
      throw error;
    }
  });
  if (!missed) {
    return;
  }
  await view.page.reload();
  await view.shown();
  await check();
}
