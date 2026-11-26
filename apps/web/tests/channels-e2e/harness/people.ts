import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type APIRequestContext, request } from '@playwright/test';
import { runDirectory, stackUrl } from './stack';

/**
 * The suite's people. Ada, Ben and Cy share a team; Dee is outside it. There
 * are several such casts of four, one for each parallel worker, so that what
 * one worker's tests do never reaches the pages of another's: every open page
 * of a person hears of every channel and message that person is part of. On a
 * local stack the casts come from `seed/scenarios/channels-e2e.json`; on
 * another stack, name the accounts in `CHANNELS_E2E_PEOPLE` (comma separated,
 * four for each cast, in this order) whose first three share a team.
 */
export const PERSON_KEYS = ['ada', 'ben', 'cy', 'dee'] as const;
export type PersonKey = (typeof PERSON_KEYS)[number];

export type Person = {
  key: PersonKey;
  email: string;
  /** The id services know the person by. */
  userId: string;
  firstName: string;
  /** The name the app shows for the person. */
  name: string;
  /** The team the person is in, when they are in one. */
  teamId: string | undefined;
};

const SEEDED_CASTS = 6;

function namedAccounts(): string[] | undefined {
  return process.env.CHANNELS_E2E_PEOPLE?.split(',').map((email) =>
    email.trim()
  );
}

/** How many casts the stack has: one worker can run for each. */
export function castCount(): number {
  const named = namedAccounts();
  if (!named) return SEEDED_CASTS;
  if (named.length === 0 || named.length % PERSON_KEYS.length !== 0) {
    throw new Error(
      `CHANNELS_E2E_PEOPLE names ${named.length} accounts; the suite needs ${PERSON_KEYS.length} for each cast.`
    );
  }
  return named.length / PERSON_KEYS.length;
}

/**
 * The cast of the worker this is running in. Playwright numbers the workers
 * that run side by side from zero; outside a worker it is the first cast.
 */
export function cast(): number {
  return firstCast() + Number(process.env.TEST_PARALLEL_INDEX ?? 0);
}

/**
 * The first cast this run uses. Two runs at once on one stack need casts of
 * their own, so give the second `CHANNELS_E2E_FIRST_CAST`.
 */
export function firstCast(): number {
  return Number(process.env.CHANNELS_E2E_FIRST_CAST ?? 0);
}

function emails(ofCast: number): Record<PersonKey, string> {
  const named = namedAccounts();
  const out = {} as Record<PersonKey, string>;
  PERSON_KEYS.forEach((key, index) => {
    const seeded = ofCast === 0 ? key : `${key}.${ofCast}`;
    out[key] =
      named?.[ofCast * PERSON_KEYS.length + index] ??
      `${seeded}@channels-e2e.seed.macro.local`;
  });
  return out;
}

export function sessionFile(key: PersonKey, ofCast = cast()): string {
  return join(runDirectory(), `${key}-${ofCast}.session.json`);
}

function peopleFile(ofCast: number): string {
  return join(runDirectory(), `people-${ofCast}.json`);
}

/** Requests to the stack's services with the person's session. */
export function apiFor(
  key: PersonKey,
  ofCast = cast()
): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: stackUrl(),
    ignoreHTTPSErrors: true,
    storageState: sessionFile(key, ofCast),
  });
}

/**
 * Signs the person in the way the login page does on a local stack: ask for
 * a one-time code, which a local authentication service returns, and redeem
 * it. Keeps the session for the run.
 */
async function signIn(
  key: PersonKey,
  email: string,
  ofCast: number
): Promise<Person> {
  const api = await request.newContext({
    baseURL: stackUrl(),
    ignoreHTTPSErrors: true,
  });

  const asked = await api.post('/auth/login/passwordless', {
    data: { email, redirect_uri: `${stackUrl()}/app` },
  });
  const { code } = (await asked.json()) as { code?: string };
  if (!asked.ok() || !code) {
    throw new Error(
      `${email} got no sign-in code (${asked.status()}). The stack must return one-time codes, as local stacks do.`
    );
  }

  const redeemed = await api.get(
    `/auth/oauth/passwordless/${code}?email=${encodeURIComponent(email)}`,
    { maxRedirects: 0 }
  );
  if (redeemed.status() !== 303) {
    throw new Error(`${email} could not sign in (${redeemed.status()})`);
  }

  // A new account opens on onboarding; these tests are of channels.
  await api.patch('/auth/user/tutorial', { data: { tutorialComplete: true } });

  const me = (await (await api.get('/auth/user/me')).json()) as {
    user_id: string;
  };
  const named = (await (await api.get('/auth/user/name')).json()) as {
    first_name?: string | null;
    last_name?: string | null;
  };
  const teams = (await (await api.get('/auth/team/user')).json()) as {
    id: string;
  }[];

  // The login page leaves this marker for the app, which cannot read the
  // session cookies themselves.
  const state = await api.storageState();
  state.cookies.push({
    name: 'login',
    value: 'true',
    domain: new URL(stackUrl()).hostname,
    path: '/',
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  });
  writeFileSync(sessionFile(key, ofCast), JSON.stringify(state));
  await api.dispose();

  const firstName = named.first_name ?? key;
  return {
    key,
    email,
    userId: me.user_id,
    firstName,
    name: [firstName, named.last_name].filter(Boolean).join(' '),
    teamId: teams[0]?.id,
  };
}

/**
 * Signs the people of the given casts in and records who they are.
 * Runs once, before the tests.
 */
export async function signEveryoneIn(casts: number[]): Promise<void> {
  const last = Math.max(...casts);
  if (last >= castCount()) {
    throw new Error(
      `This run needs cast ${last} of people; the stack has ${castCount()} casts.`
    );
  }
  await Promise.all(
    casts.map(async (ofCast) => {
      const addresses = emails(ofCast);
      const people: Person[] = [];
      for (const key of PERSON_KEYS) {
        people.push(await signIn(key, addresses[key], ofCast));
      }
      writeFileSync(peopleFile(ofCast), JSON.stringify(people, null, 2));
    })
  );
}

export function readPeople(ofCast = cast()): Record<PersonKey, Person> {
  const people = JSON.parse(
    readFileSync(peopleFile(ofCast), 'utf8')
  ) as Person[];
  return Object.fromEntries(
    people.map((person) => [person.key, person])
  ) as Record<PersonKey, Person>;
}
