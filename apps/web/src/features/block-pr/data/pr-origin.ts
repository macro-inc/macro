/** The tool a pull request was started from. */
export type PrOriginTool =
  | 'claude'
  | 'codex'
  | 'cursor'
  | 'devin'
  | 'copilot'
  | 'jules'
  | 'macro';

/** What gave the origin away, strongest first. */
export type PrOriginSignal =
  | 'agent-session'
  | 'session-link'
  | 'description'
  | 'author'
  | 'branch';

export type PrOrigin = {
  tool: PrOriginTool;
  signal: PrOriginSignal;
  /** The session the pull request came from, when one is linked. */
  url?: string;
  /** The Macro agent session that opened the pull request. */
  sessionId?: string;
};

export const PR_ORIGIN_TOOLS: readonly PrOriginTool[] = [
  'claude',
  'codex',
  'cursor',
  'devin',
  'copilot',
  'jules',
  'macro',
];

export const PR_ORIGIN_LABELS: Record<PrOriginTool, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  devin: 'Devin',
  copilot: 'Copilot',
  jules: 'Jules',
  macro: 'Macro',
};

export const PR_ORIGIN_SIGNAL_LABELS: Record<PrOriginSignal, string> = {
  'agent-session': 'opened by a Macro agent session',
  'session-link': 'session linked in the description',
  description: 'named in the description',
  author: 'opened by its bot account',
  branch: 'from its branch name',
};

/** The tool behind a Macro agent harness slug. */
export function toolForHarness(harness: string | undefined): PrOriginTool {
  if (!harness) return 'macro';
  if (harness.startsWith('claude')) return 'claude';
  if (harness.startsWith('codex')) return 'codex';
  if (harness.startsWith('cursor')) return 'cursor';
  return 'macro';
}

/** Session links agents leave in the pull requests they open. */
const SESSION_LINKS: readonly [PrOriginTool, RegExp][] = [
  ['claude', /https:\/\/claude\.ai\/code\/[\w-]+/i],
  ['codex', /https:\/\/chatgpt\.com\/codex\/tasks\/[\w-]+/i],
  [
    'cursor',
    /https:\/\/(?:www\.)?cursor\.com\/(?:agents|background-agent)[^\s)\]"'>]*/i,
  ],
  ['devin', /https:\/\/app\.devin\.ai\/sessions\/[\w-]+/i],
  ['jules', /https:\/\/jules\.google\.com\/[^\s)\]"'>]+/i],
  ['macro', /https:\/\/(?:[\w-]+\.)?macro\.com\/app\/agent\/[\w-]+/i],
];

/** Footers and trailers that name the tool without a session link. */
const DESCRIPTION_MARKS: readonly [PrOriginTool, RegExp][] = [
  ['claude', /generated with \[?claude code|co-authored-by:\s*claude\b/i],
  ['codex', /\bcodex task\b|chatgpt\.com\/codex/i],
  ['cursor', /cursor\.com\/(?:agents|background-agent)|\bcursor agent\b/i],
  ['devin', /\bdevin run\b|app\.devin\.ai/i],
  ['copilot', /\bcopilot coding agent\b/i],
  ['jules', /jules\.google\.com/i],
];

/** Bot accounts that open pull requests for these tools. */
const AUTHORS: readonly [PrOriginTool, RegExp][] = [
  ['copilot', /^(?:copilot|copilot-swe-agent)(?:\[bot\])?$/i],
  ['devin', /^devin-ai-integration(?:\[bot\])?$/i],
  ['cursor', /^cursor(?:agent)?(?:\[bot\])?$/i],
  ['codex', /^chatgpt-codex-connector(?:\[bot\])?$/i],
  ['claude', /^claude(?:\[bot\])?$/i],
  ['jules', /^google-labs-jules(?:\[bot\])?$/i],
];

/** Branch prefixes these tools name their branches with. */
const BRANCHES: readonly [PrOriginTool, RegExp][] = [
  ['claude', /^claude\//i],
  ['codex', /^codex\//i],
  ['cursor', /^cursor\//i],
  ['devin', /^devin\//i],
  ['copilot', /^copilot\//i],
  ['jules', /^jules[-/]/i],
];

const firstMatch = (
  patterns: readonly [PrOriginTool, RegExp][],
  value: string | undefined
) => {
  if (!value) return undefined;
  for (const [tool, pattern] of patterns) {
    const found = value.match(pattern);
    if (found) return { tool, match: found[0] };
  }
  return undefined;
};

/**
 * Where a pull request was started, from the strongest signal it carries: a
 * Macro agent session that opened it, a session link or footer in its
 * description, the bot account that opened it, or its branch name. Pull
 * requests opened outside Macro are recognized the same way.
 */
export function detectPrOrigin(input: {
  description?: string | null;
  headBranch?: string | null;
  authorLogin?: string | null;
  /** Linked Macro agent sessions; only one whose agent opened the PR counts. */
  sessions?: readonly {
    id: string;
    source: 'agent' | 'user';
    harness?: string;
  }[];
}): PrOrigin | undefined {
  const opener = input.sessions?.find((session) => session.source === 'agent');
  if (opener)
    return {
      tool: toolForHarness(opener.harness),
      signal: 'agent-session',
      sessionId: opener.id,
    };

  const description = input.description ?? undefined;
  const link = firstMatch(SESSION_LINKS, description);
  if (link) return { tool: link.tool, signal: 'session-link', url: link.match };

  const mark = firstMatch(DESCRIPTION_MARKS, description);
  if (mark) return { tool: mark.tool, signal: 'description' };

  const author = firstMatch(AUTHORS, input.authorLogin ?? undefined);
  if (author) return { tool: author.tool, signal: 'author' };

  const branch = firstMatch(BRANCHES, input.headBranch ?? undefined);
  if (branch) return { tool: branch.tool, signal: 'branch' };

  return undefined;
}
