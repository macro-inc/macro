import type { ComputerSize } from '@service-auth/computers';
import type { CreateTeamAgent } from '@service-auth/team-agents';

/** Longest agent name, in characters; matches the server's limit. */
export const MAX_AGENT_NAME_CHARS = 64;

/**
 * What an admin has filled in to add an agent: its name and computer.
 * Picture, voice and role come later; the agent asks what to take on.
 */
export type TeamAgentDraft = {
  name: string;
  size: ComputerSize | undefined;
  /** Minted once per purchase and reused on retry, so a retry buys nothing twice. */
  purchaseKey: string;
};

/** What keeps the draft from being sent, worst first. */
export type AddBlocker = 'name' | 'name_too_long' | 'size';

/** The first thing to fix before the draft can be sent, if any. */
export function addBlocker(draft: TeamAgentDraft): AddBlocker | undefined {
  const name = draft.name.trim();
  if (!name) return 'name';
  // The server counts characters, not UTF-16 units.
  if (Array.from(name).length > MAX_AGENT_NAME_CHARS) return 'name_too_long';
  if (!draft.size) return 'size';
  return undefined;
}

/** The request for a draft with nothing to fix, or `undefined`. */
export function teamAgentRequest(
  draft: TeamAgentDraft
): CreateTeamAgent | undefined {
  if (addBlocker(draft) || !draft.size) return undefined;
  return {
    name: draft.name.trim(),
    // Left empty, the agent asks what to take on once it is online.
    jobDescription: '',
    personality: '',
    size: draft.size,
    avatarUrl: null,
    purchaseKey: draft.purchaseKey,
  };
}
