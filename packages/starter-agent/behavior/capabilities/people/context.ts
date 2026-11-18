import { chmod } from 'node:fs/promises';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import type { Base } from '../../context/index.ts';
import type { ChatContext } from '../chat/context.ts';
import { type PeopleClaude, sdkAsk } from './ask.ts';
import { appraiseModel, contextLines, logStream, owner } from './config.ts';
import { keeping, peoplePort } from './keep.ts';
import { sdkAuthorOf } from './macro.ts';
import { store } from './store.ts';

const ownerOnlyFile = 0o600;
const ownerOnlyDirectory = 0o700;

/**
 * What the people area adds to the agent's context: `people`, the port other areas
 * use, and `keeping`, the area's own working parts. It reads conversations
 * through chat's history, so it needs chat's context.
 */
export const peopleContext = (
  { config, state, join, disk, clock, log, macro }: Base,
  { history }: Pick<ChatContext, 'history'>,
  /** How it runs Claude Code: as the agent's wakes do. */
  claude: PeopleClaude
) => {
  const directory = state.private(owner);
  const kept = keeping({
    store: store({
      directory,
      join,
      disk,
      clock,
      // Files are private to the agent's user, as is the directory they are in.
      restrict: (path) =>
        chmod(path, path === directory ? ownerOnlyDirectory : ownerOnlyFile),
    }),
    who: { me: config.me, owner: config.owner, name: config.identity.name },
    ask: sdkAsk({ query, defaultModel: appraiseModel, claude }),
    authorOf: sdkAuthorOf(macro),
    recent: (channelId) => history.recent(channelId, contextLines),
    log,
    stream: logStream,
    clock,
  });
  return behavior<Base & Pick<ChatContext, 'history'>>().decorate({
    people: peoplePort(kept, { log, stream: logStream }),
    keeping: kept,
  });
};

export type PeopleContext = ContextOf<ReturnType<typeof peopleContext>>;
