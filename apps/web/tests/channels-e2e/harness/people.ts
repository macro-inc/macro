import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type APIRequestContext, request } from '@playwright/test';
import { runDirectory, stackUrl } from './stack';

/**
 * The suite's people. Ada, Ben and Cy share a team; Dee is outside it. On a
 * local stack they come from `seed/scenarios/channels-e2e.json`; on another
 * stack, name four accounts in `CHANNELS_E2E_PEOPLE` (comma separated, in
 * this order) whose first three share a team.
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

function emails(): Record<PersonKey, string> {
  const named = process.env.CHANNELS_E2E_PEOPLE?.split(',').map((email) =>
    email.trim()
  );
  if (named && named.length !== PERSON_KEYS.length) {
    throw new Error(
      `CHANNELS_E2E_PEOPLE names ${named.length} accounts; the suite needs ${PERSON_KEYS.length}.`
    );
  }

  const out = {} as Record<PersonKey, string>;
  PERSON_KEYS.forEach((key, index) => {
    out[key] = named?.[index] ?? `${key}@channels-e2e.seed.macro.local`;
  });
  return out;
}

export function sessionFile(key: PersonKey): string {
  return join(runDirectory(), `${key}.session.json`);
}

function peopleFile(): string {
  return join(runDirectory(), 'people.json');
}

/** Requests to the stack's services with the person's session. */
export function apiFor(key: PersonKey): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: stackUrl(),
    ignoreHTTPSErrors: true,
    storageState: sessionFile(key),
  });
}

/**
 * Signs the person in the way the login page does on a local stack: ask for
 * a one-time code, which a local authentication service returns, and redeem
 * it. Keeps the session for the run.
 */
async function signIn(key: PersonKey, email: string): Promise<Person> {
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
  writeFileSync(sessionFile(key), JSON.stringify(state));
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

/** Signs everyone in and records who they are. Runs once, before the tests. */
export async function signEveryoneIn(): Promise<void> {
  const addresses = emails();
  const people: Person[] = [];
  for (const key of PERSON_KEYS) {
    people.push(await signIn(key, addresses[key]));
  }
  writeFileSync(peopleFile(), JSON.stringify(people, null, 2));
}

export function readPeople(): Record<PersonKey, Person> {
  const people = JSON.parse(readFileSync(peopleFile(), 'utf8')) as Person[];
  return Object.fromEntries(
    people.map((person) => [person.key, person])
  ) as Record<PersonKey, Person>;
}
