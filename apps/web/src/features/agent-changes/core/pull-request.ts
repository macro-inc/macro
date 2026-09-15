/**
 * Opening a pull request from the pane.
 *
 * The agent owns the branch, so it opens the pull request: the pane drafts
 * a title and description, lets the reviewer adjust them, and posts one
 * prompt asking the agent to create the PR and register its URL with Macro.
 * The session's `pullRequestUrl` landing is the success signal.
 */

import type { Changeset } from './changeset';

export type PullRequestDraft = {
  title: string;
  body: string;
};

export type PullRequestForm = PullRequestDraft & {
  /** Branch the pull request targets; the changeset's base by default. */
  base: string;
  /** GitHub logins to request reviews from. */
  reviewers: string[];
  draft: boolean;
};

/** Which of the four ways to open the pull request the reviewer picked. */
export type PullRequestAction = 'quick' | 'draft' | 'edit' | 'github';

/** The form as it first opens, from the generated draft and the changeset. */
export function initialPullRequestForm(
  draft: PullRequestDraft,
  changeset: Changeset,
  options: { draft?: boolean } = {}
): PullRequestForm {
  return {
    title: draft.title,
    body: draft.body,
    base: changeset.base.name ?? '',
    reviewers: [],
    draft: options.draft ?? false,
  };
}

/** Split typed reviewer handles on commas and whitespace, dropping `@`. */
export function parseReviewers(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/[\s,]+/)) {
    const handle = raw.replace(/^@/, '').trim();
    if (handle) seen.add(handle);
  }
  return [...seen];
}

function fence(body: string): string {
  // A body that itself contains a fence needs a longer one around it.
  let ticks = '```';
  while (body.includes(ticks)) ticks += '`';
  return `${ticks}markdown\n${body.trim()}\n${ticks}`;
}

/**
 * The prompt that asks the agent to open the pull request. Everything the
 * reviewer decided is spelled out so the agent has nothing to infer, and the
 * closing instruction is what links the PR back to this session.
 */
export function buildPullRequestPrompt(
  form: PullRequestForm,
  changeset: Changeset
): string {
  const lines: string[] = [];
  lines.push(
    form.draft
      ? 'Open a draft pull request for the changes in this session.'
      : 'Open a pull request for the changes in this session.'
  );
  lines.push('');
  const head = changeset.head.name;
  if (head)
    lines.push(
      `- Head branch: \`${head}\` (push it first if it is not on GitHub yet)`
    );
  if (form.base) lines.push(`- Base branch: \`${form.base}\``);
  if (form.reviewers.length > 0) {
    lines.push(
      `- Request reviews from: ${form.reviewers.map((r) => `@${r}`).join(', ')}`
    );
  }
  lines.push(`- Title: ${form.title.trim()}`);
  lines.push('- Description (use it verbatim):');
  lines.push('');
  lines.push(fence(form.body));
  lines.push('');
  lines.push(
    'Do not change the code. When the pull request exists, register its URL with Macro using the `set_pull_request` tool and reply with the URL.'
  );
  return lines.join('\n');
}

/** `#1482` from a GitHub pull request url, when it is one. */
export function pullRequestNumber(url: string): number | undefined {
  const match = /\/pull\/(\d+)(?:[/?#]|$)/.exec(url);
  return match ? Number(match[1]) : undefined;
}

/** Where the pull request composer is, from closed through opened. */
export type PullRequestSheet =
  | { kind: 'closed' }
  /** Waiting on the draft before the quick path can post. */
  | { kind: 'drafting'; draft: boolean }
  | {
      kind: 'form';
      form: PullRequestForm;
      /** A (re)generation is running; the fields dim. */
      drafting: boolean;
      error?: string;
    }
  /** The prompt is with the agent; nothing to do but wait. */
  | { kind: 'creating'; form: PullRequestForm; previousUrl: string | undefined }
  | { kind: 'opened'; url: string; title: string | undefined };
