// Shared helpers for the channel directory proof scripts: sign-in against a
// local stack and authenticated requests with a per-person cookie jar.

export const STACK = process.env.STACK_URL ?? 'https://localhost:29509';
const TLS = { rejectUnauthorized: false };

export type Session = { email: string; userId: string; cookies: string };

function mergeCookies(jar: Map<string, string>, response: Response) {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const index = pair.indexOf('=');
    if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function retry<T>(label: string, work: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await work();
    } catch (error) {
      last = error;
      await Bun.sleep(500 * (attempt + 1));
    }
  }
  throw new Error(`${label}: ${String(last)}`);
}

/** Signs a person in the way a local stack's login page does. */
export async function signIn(email: string): Promise<Session> {
  return retry(`sign in ${email}`, async () => {
    const jar = new Map<string, string>();
    const asked = await fetch(`${STACK}/auth/login/passwordless`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, redirect_uri: `${STACK}/app` }),
      tls: TLS,
    });
    const { code } = (await asked.json()) as { code?: string };
    if (!asked.ok || !code) throw new Error(`no code (${asked.status})`);
    const redeemed = await fetch(
      `${STACK}/auth/oauth/passwordless/${code}?email=${encodeURIComponent(email)}`,
      { redirect: 'manual', tls: TLS }
    );
    if (redeemed.status !== 303) throw new Error(`redeem ${redeemed.status}`);
    mergeCookies(jar, redeemed);
    const tutorial = await fetch(`${STACK}/auth/user/tutorial`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: cookieHeader(jar),
      },
      body: JSON.stringify({ tutorialComplete: true }),
      tls: TLS,
    });
    mergeCookies(jar, tutorial);
    const me = await fetch(`${STACK}/auth/user/me`, {
      headers: { cookie: cookieHeader(jar) },
      tls: TLS,
    });
    if (!me.ok) throw new Error(`me ${me.status}`);
    const { user_id: userId } = (await me.json()) as { user_id: string };
    return { email, userId, cookies: cookieHeader(jar) };
  });
}

export type Timed<T> = { body: T; bytes: number; ms: number };

/** An authenticated request; the body's size and the wall time come back. */
export async function call<T>(
  session: Session,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<Timed<T>> {
  return retry(`${init.method ?? 'GET'} ${path}`, async () => {
    const started = performance.now();
    const response = await fetch(`${STACK}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        cookie: session.cookies,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      tls: TLS,
    });
    const text = await response.text();
    const ms = performance.now() - started;
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 200)}`);
    return { body: JSON.parse(text) as T, bytes: text.length, ms };
  });
}

/** A GraphQL request to the soup endpoint; errors throw. */
export async function graphql<T>(
  session: Session,
  query: string,
  variables: unknown
): Promise<Timed<T>> {
  const result = await call<{ data?: T; errors?: unknown[] }>(
    session,
    '/dss/items/soup/graphql',
    { method: 'POST', body: { query, variables } }
  );
  if (result.body.errors?.length || !result.body.data)
    throw new Error(JSON.stringify(result.body.errors).slice(0, 500));
  return { body: result.body.data, bytes: result.bytes, ms: result.ms };
}
