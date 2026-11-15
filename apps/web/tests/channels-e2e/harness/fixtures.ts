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
      return context.newPage();
    });
    for (const context of opened) {
      await context.close();
    }
  },
});

export { expect } from '@playwright/test';
