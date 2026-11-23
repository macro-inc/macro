/**
 * The agent acts on GitHub only as itself, with the token in its
 * environment. Without that token, gh and a push would fall back to
 * whatever login the machine has, which belongs to its user, so the
 * agent's sessions are denied both until the token is added. The
 * environment fails closed on its own (`noIdentity`,
 * behavior/context/identity.ts); this names the reason, and holds when a
 * command undoes that environment. The user's own sessions aren't the
 * agent's and pass. Only real commands count: a push command quoted in a
 * message is just text.
 */
import { githubToken } from '../../context/identity.ts';
import { bashCommand, type Guard, type ToolCall } from '../guard.ts';
import { gitParts, isAgentSession, setsToken } from './session.ts';
import { type Command, commands, program } from './shell.ts';

export const identityReason = `This run has no GitHub token, so gh or a push would act as the machine's own login, which belongs to its user, not to you. GitHub needs the ${githubToken} credential: ask your owner to add it to your credentials; you can't store one yourself.`;

const actsOnGithub = (command: Command, call: ToolCall): boolean => {
  const name = program(command);
  if (name === 'gh') return true;
  return name === 'git' && gitParts(command, call).args[0] === 'push';
};

/** Why this call is denied, or undefined. */
export const ghIdentity = (call: ToolCall): string | undefined => {
  const command = bashCommand(call);
  // With the agent's token in the environment, gh and git are already it.
  if (
    command === undefined ||
    !isAgentSession(call.environment) ||
    call.environment.GH_TOKEN
  )
    return undefined;
  const all = commands(command);
  if (all.some(setsToken)) return undefined;
  return all.some((each) => actsOnGithub(each, call))
    ? identityReason
    : undefined;
};

export const ghIdentityGuard: Guard = {
  name: 'gh-identity',
  check: ghIdentity,
};
