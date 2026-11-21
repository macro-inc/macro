// A lapsed session must not turn writes into 401s: sign a seeded viewer in,
// replace its token with an invalid one, and make an authenticated call.
// `call` should sign the viewer in again and succeed.
import { readFileSync } from 'node:fs';
import { call, HttpError, signIn, stackFromEnv } from './lib/stack.ts';

const stack = stackFromEnv();
const world = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { users: Record<string, { email: string }> };
const [key, { email }] = Object.entries(world.users)[0];
const user = await signIn(stack, key, email);
const before = user.token;
user.token = `${before.split('.').slice(0, 2).join('.')}.invalid`;
user.cookie = user.cookie.replace(/access-token=[^;]+/, `access-token=${user.token}`);
const path = '/auth/user/tutorial';
try {
  await call(stack, user, path, { method: 'PATCH', body: { tutorialComplete: true } });
  console.log(`refreshed: ${user.token !== before && !user.token.endsWith('.invalid')}; call succeeded`);
} catch (error) {
  console.log(`call failed: ${error instanceof HttpError ? error.status : String(error)} ${String(error).slice(0, 200)}`);
  process.exitCode = 1;
}
