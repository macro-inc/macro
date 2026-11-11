import type { ComputerSize } from '@service-auth/computers';
import type { CreateTeamAgent } from '@service-auth/team-agents';

/** Longest agent name, in characters; matches the server's limit. */
export const MAX_AGENT_NAME_CHARS = 64;

/** Longest job description or personality, in characters. */
export const MAX_AGENT_PROFILE_CHARS = 4000;

/** What an admin has typed into the agent invite form so far. */
export type TeamAgentDraft = {
  name: string;
  jobDescription: string;
  personality: string;
  size: ComputerSize | undefined;
  avatarUrl: string | undefined;
  /** The Aura-2 model picked; left out, the agent gets its template's voice. */
  voice?: string;
  /** Minted once per dialog and reused on retry, so a retry buys nothing twice. */
  purchaseKey: string;
};

export type DraftFieldProblem = 'required' | 'too_long';

export type TeamAgentDraftProblems = {
  name?: DraftFieldProblem;
  jobDescription?: DraftFieldProblem;
  personality?: DraftFieldProblem;
  size?: 'required';
};

function fieldProblem(
  value: string,
  limit: number
): DraftFieldProblem | undefined {
  const trimmed = value.trim();
  if (!trimmed) return 'required';

  // The server counts characters, not UTF-16 units.
  if (Array.from(trimmed).length > limit) return 'too_long';
  return undefined;
}

/** Field problems the server would reject the draft for. */
export function teamAgentDraftProblems(
  draft: TeamAgentDraft
): TeamAgentDraftProblems {
  const problems: TeamAgentDraftProblems = {};

  const name = fieldProblem(draft.name, MAX_AGENT_NAME_CHARS);
  if (name) problems.name = name;

  const jobDescription = fieldProblem(
    draft.jobDescription,
    MAX_AGENT_PROFILE_CHARS
  );
  if (jobDescription) problems.jobDescription = jobDescription;

  const personality = fieldProblem(draft.personality, MAX_AGENT_PROFILE_CHARS);
  if (personality) problems.personality = personality;

  if (!draft.size) problems.size = 'required';
  return problems;
}

/** The request for a draft with no problems, or `undefined`. */
export function teamAgentRequest(
  draft: TeamAgentDraft
): CreateTeamAgent | undefined {
  const problems = teamAgentDraftProblems(draft);
  if (Object.keys(problems).length > 0 || !draft.size) return undefined;

  return {
    name: draft.name.trim(),
    jobDescription: draft.jobDescription.trim(),
    personality: draft.personality.trim(),
    size: draft.size,
    avatarUrl: draft.avatarUrl ?? null,
    purchaseKey: draft.purchaseKey,
    ...(draft.voice ? { voice: draft.voice } : {}),
  };
}
