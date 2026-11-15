import type { Guard } from '../guard.ts';
import { ghIdentityGuard } from './gh-identity.ts';
import { gitIdentityGuard } from './git-identity.ts';
import { noEmail } from './no-email.ts';

/** Every guardrail on the agent's tool calls. Each is one file here, added to this list. */
export const guards: readonly Guard[] = [
  ghIdentityGuard,
  gitIdentityGuard,
  noEmail,
];
