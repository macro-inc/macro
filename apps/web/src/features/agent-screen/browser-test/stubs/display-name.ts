import { AGENT, AGENT_NAME } from './dm';

export * from '../../../../lib/core/user/displayName';

export function isAgentAccount(id: string | undefined | null) {
  return id === AGENT;
}

export function getDisplayName(id: string | undefined | null) {
  return id === AGENT ? AGENT_NAME : 'You';
}
