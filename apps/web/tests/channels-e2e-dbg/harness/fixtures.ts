import { readFileSync } from 'node:fs';
import {
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
  context: async ({ context }, use) => {
    dbgListen(context, "page");
    await use(context);
  },
  storageState: async ({}, use) => {
    await use(session('ada'));
  },
  ada: api('ada'),
  ben: api('ben'),
  cy: api('cy'),
  dee: api('dee'),
  pageFor: async ({ browser }, use) => {
    const opened: { close(): Promise<void> }[] = [];
    await use(async (key) => {
      const context = await browser.newContext({
        storageState: session(key),
      });
      opened.push(context);
      dbgListen(context, key);
      return context.newPage();
    });
    for (const context of opened) {
      await context.close();
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
    console.log("DD " + test.info().title.slice(0, 6) + " w" + test.info().parallelIndex + " ANNOT " + (Date.now() % 1000000) + " " + String(error).replace(/\x1b\[[0-9;]*m/g, "").slice(0, 900).split("\n").join(" | "));
    test.info().annotations.push({
      type: 'intermittent-defect',
      description: String(error).split('\n')[0],
    });
  }
}

/**
 * Whether the app under test was built with `VITE_ENABLE_GRAPHQL_SOUP=true`,
 * which the page cannot show. CI sets the variable for the build and the run
 * alike; a local run against a stack built with it must set it too.
 */
export const SOUP_BUILD = process.env.VITE_ENABLE_GRAPHQL_SOUP === 'true';

/**
 * Marks the test as one a known product defect fails in every run, on the
 * builds named: without the flag, with it, or both. The test is listed in
 * `ledger/known-defects.tsv` with the same builds.
 */
export function knownDefect(builds: 'off' | 'on' | 'both'): void {
  test.fail(builds === 'both' || (builds === 'on') === SOUP_BUILD);
}

/** `failsSometimes` on the builds with the flag, a plain check on the others. */
export async function failsSometimesWithSoup(
  check: () => Promise<void>
): Promise<void> {
  if (SOUP_BUILD) await failsSometimes(check);
  else await check();
}

function dbgListen(context: import('@playwright/test').BrowserContext, who: string): void {
  const tag = () => test.info().title.slice(0, 6) + ' w' + test.info().parallelIndex + ' r' + test.info().repeatEachIndex + ' ' + who + ' ' + (Date.now() % 1000000);
  context.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('DBG') || t.includes('physical reset') || t.includes('owner epoch')) console.log('DD ' + tag() + ' ' + t.slice(0, 1500));
    else if (t.includes('mutation_queue'))
      void Promise.all(m.args().map((a) => a.jsonValue().catch(() => '?'))).then((a) =>
        console.log('DJ ' + tag() + ' ' + JSON.stringify(a).slice(0, 700))
      );
  });
}
