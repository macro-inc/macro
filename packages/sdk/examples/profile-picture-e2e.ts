// End-to-end check of profile pictures against a local stack:
// `bun examples/profile-picture-e2e.ts` after `just run_local` and
// `just seed-scenario apply --file seed/scenarios/team-perms.json`.
//
// Alice switches pictures through the SDK; teammates and channel contacts
// must hear `user.picture_changed` live (SDK SSE and the connection gateway),
// and an outsider must not.

import { StaticImage } from '../src/entities/images/image';
import { resolveLocalPortmap } from '../src/local-portmap';
import { Macro } from '../src/macro';
import { MacroError } from '../src/utils';

const portmap = resolveLocalPortmap();
if (!portmap) throw new Error('no local stack portmap; run `just run_local`');
const { auth: authHost, connection } = portmap.hosts;
if (!authHost || !connection) throw new Error('portmap lacks auth/connection');
const gatewayHost = connection.replace(/^http/, 'ws');

const domain = 'seed.macro.local';
const emailOf = (name: string) => `${name}@${domain}`;

async function login(name: string): Promise<string> {
  const email = emailOf(name);
  const started = await fetch(`${authHost}/login/passwordless`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, redirect_uri: `${portmap.webAppUrl}/app` }),
  });
  const { code } = (await started.json()) as { code?: string };
  if (!code) throw new Error(`no passwordless code for ${name}`);
  const tokens = await fetch(
    `${authHost}/oauth/passwordless/${code}?email=${encodeURIComponent(email)}&disable_redirect=true`,
  );
  const { access_token } = (await tokens.json()) as { access_token: string };
  const api = await fetch(`${authHost}/jwt/macro_api_token`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!api.ok) throw new Error(`macro_api_token ${api.status} for ${name}`);
  const { macro_api_token } = (await api.json()) as { macro_api_token: string };
  return macro_api_token;
}

// A 1x1 PNG whose single pixel differs per image, so uploads differ.
function png(red: number): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const copy = new Uint8Array(new ArrayBuffer(bytes.length + 1));
  copy.set(bytes);
  copy[bytes.length] = red; // trailing byte after IEND; decoders ignore it
  return copy;
}

const results: Array<[string, boolean, string?]> = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push([name, ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const names = ['alice', 'bob', 'dave', 'eve'] as const;
const tokens = Object.fromEntries(
  await Promise.all(names.map(async (n) => [n, await login(n)] as const)),
) as Record<(typeof names)[number], string>;
const sdk = (n: (typeof names)[number]) =>
  new Macro({ env: 'local', auth: { type: 'user', token: tokens[n] } });

const alice = sdk('alice');
const aliceId = `macro|${emailOf('alice')}`;

// Live listeners: SDK SSE stream and raw connection-gateway socket.
type Name = (typeof names)[number];
const seen = (): Record<Name, string[]> => ({
  alice: [],
  bob: [],
  dave: [],
  eve: [],
});
const sseSeen = seen();
const gatewaySeen = seen();
const stops: Array<() => void> = [];
for (const n of names) {
  const m = sdk(n);
  m.events.on('user.picture_changed', (e) => {
    sseSeen[n].push(`${e.user.id}:${e.metadata.file_id ?? 'none'}`);
  });
  stops.push(await m.events.listen());
  const ws = new WebSocket(`${gatewayHost}?macro-api-token=${tokens[n]}`);
  ws.onmessage = (msg) => {
    if (typeof msg.data !== 'string' || msg.data === 'pong') return;
    try {
      const parsed = JSON.parse(msg.data) as { type: string; data: unknown };
      if (parsed.type !== 'user_picture_changed') return;
      const data =
        typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
      gatewaySeen[n].push((data as { user_id: string }).user_id);
    } catch {}
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`gateway socket failed for ${n}`));
  });
  stops.push(() => ws.close());
}
await Bun.sleep(1500);

// 1. Upload two pictures and set the first.
const first = await alice.me.uploadProfilePicture(png(1), {
  fileName: 'first.png',
  contentType: 'image/png',
});
const second = await alice.me.uploadProfilePicture(png(2), {
  fileName: 'second.png',
  contentType: 'image/png',
});
await alice.me.update({ profilePicture: first });
const mine = await alice.me.profilePicture();
check(
  'me.profilePicture() returns the set image',
  mine instanceof StaticImage && mine.id === first.id,
  mine?.url,
);

// 2. Another user reads it.
const bob = sdk('bob');
const seenByBob = await bob.users.byId(aliceId).profilePicture();
check(
  'users.byId(alice).profilePicture() from bob',
  seenByBob instanceof StaticImage && seenByBob.id === first.id,
);
const batch = await bob.users.profilePictures([bob.users.byId(aliceId)]);
check('users.profilePictures batch', [...batch.values()][0]?.url === first.url);

// 3. Throttle: an immediate second change is rejected with 429.
let throttled = false;
try {
  await alice.me.update({ profilePicture: second });
} catch (error) {
  throttled = error instanceof MacroError || error instanceof Error;
  console.log('  throttle error:', (error as Error).message);
}
check('second change within 1s is throttled', throttled);

// 4. Switch back to saved uploads by id, without re-uploading, after the
// throttle window.
await Bun.sleep(1100);
await alice.me.update({ profilePicture: alice.images.byId(second.id) });
await Bun.sleep(1100);
await alice.me.update({ profilePicture: alice.images.byId(first.id) });
const back = await alice.me.profilePicture();
check(
  'switch to saved uploads by id (no re-upload)',
  back instanceof StaticImage && back.id === first.id,
);

// 5. Live delivery.
await Bun.sleep(4000);
for (const n of ['alice', 'bob', 'dave'] as const) {
  check(
    `gateway user_picture_changed reaches ${n}`,
    gatewaySeen[n].includes(aliceId),
    `${gatewaySeen[n].length} message(s)`,
  );
  check(
    `SDK SSE user.picture_changed reaches ${n}`,
    sseSeen[n].some((s) => s.startsWith(aliceId)),
    sseSeen[n].join(', '),
  );
}
check('gateway skips outsider eve', gatewaySeen.eve.length === 0);
check('SDK SSE skips outsider eve', sseSeen.eve.length === 0);

for (const stop of stops) stop();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
