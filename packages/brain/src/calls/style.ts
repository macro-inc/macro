export const MAX_SENTENCES = 3;
export const MAX_WORDS = 60;
const CHECKS: [RegExp, string][] = [
  [
    /(\b[\w']+(\s[\w']+){0,2},\s+){3,}(and|or)\b|(\b[\w']+(\s[\w']+){0,2},\s+){2,}[\w']+(\s[\w']+){0,3}\s(and|or)\s/i,
    'runs through a list',
  ],
  [/^\s*([-*•]|\d+[.)])\s/m, 'bullet or numbered list'],
  [
    /\b(first(ly)?|second(ly)?|third(ly)?)\b.*\b(second(ly)?|third(ly)?|finally)\b/i,
    'enumerates',
  ],
  [/[*_#`|]|\[[^\]]+\]\(/, 'markdown'],
  [/https?:\/\/|www\./i, 'reads out a URL'],
  [
    /\b[\w-]+\/[\w./-]+|\b\w+\.(ts|md|json|sh|py|rs)\b/i,
    'reads out a path or file',
  ],
  [/\b(PR|pull request|issue)\s*#?\d+|#\d+\b/i, 'cites PR or issue numbers'],
  [/\b[0-9a-f]{7,}\b/i, 'reads out an id or hash'],
  [
    /\b(CI|branch|rebase|merge[ds]?|commit(ted|s)?|worktree)\b/,
    'status-report jargon',
  ],
  [
    /\b(waiting on you|blocked on you|need your (click|okay|ok|approval))\b/i,
    'asks the client to unblock him',
  ],
  [
    /\b(great question|happy to help|i hope this helps|let me know if|as an ai)\b/i,
    'AI-speak',
  ],
];
export type Score = {
  ok: boolean;
  problems: string[];
  sentences: number;
  words: number;
};
export function scoreSpoken(reply: string): Score {
  const text = reply.trim();
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => /\w/.test(s)).length;
  const words = text.split(/\s+/).filter(Boolean).length;
  const problems: string[] = [];
  if (!text) problems.push('empty');
  if (sentences > MAX_SENTENCES)
    problems.push(`${sentences} sentences (max ${MAX_SENTENCES})`);
  if (words > MAX_WORDS) problems.push(`${words} words (max ${MAX_WORDS})`);
  const body = text
    .split(/(?<=[.!?;])\s+/)
    .map((s) =>
      s.replace(
        /^\s*(after that|honestly|so|well|yeah|yep|okay|ok|right|look|also|plus|anyway|then|and|but|mostly|first|now|still),\s+/i,
        ''
      )
    )
    .map((s) =>
      s.replace(
        /,?\s+(like|such as|including)\s+[\w']+(\s[\w']+)?(,\s*[\w']+(\s[\w']+)?)?,?\s+(and|or)\s+[\w']+(\s[\w']+)?/gi,
        ''
      )
    )
    .join(' ');
  for (const [re, why] of CHECKS)
    if (re.test(why === 'runs through a list' ? body : text))
      problems.push(why);
  return { ok: problems.length === 0, problems, sentences, words };
}
