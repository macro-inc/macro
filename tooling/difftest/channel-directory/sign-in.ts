// Signs in (and so creates) the generated people, and saves their sessions.
// Usage: bun sign-in.ts <count> <out.json>
import { type Session, signIn } from './lib';

const count = Number(process.argv[2] ?? 41);
const out = process.argv[3] ?? 'sessions.json';

export function personEmail(index: number) {
  return index === 0
    ? 'gqlchan-heavy@example.com'
    : `gqlchan-${String(index).padStart(2, '0')}@example.com`;
}

const sessions: Session[] = [];
for (let index = 0; index < count; index++) {
  sessions.push(await signIn(personEmail(index)));
}
await Bun.write(out, JSON.stringify(sessions, null, 2));
console.log(`${sessions.length} people signed in; first ${sessions[0]?.userId}`);
