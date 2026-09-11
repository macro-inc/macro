/**
 * The slice of the GitHub issue-comment API the iOS preview needs. Kept apart
 * from `appetize.ts` so that module stays pure and unit-testable.
 */

import type { IssueComment } from './appetize';

const GITHUB_API = 'https://api.github.com';

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
  };
}

export async function fetchIssueComments(
  repo: string,
  pullRequestNumber: number,
  token: string
): Promise<IssueComment[]> {
  const response = await fetch(
    `${GITHUB_API}/repos/${repo}/issues/${pullRequestNumber}/comments?per_page=100`,
    { headers: headers(token) }
  );
  if (!response.ok) {
    console.error(`Failed to fetch comments: ${response.status}`);
    process.exit(1);
  }
  return (await response.json()) as IssueComment[];
}

export async function createComment(
  repo: string,
  pullRequestNumber: number,
  token: string,
  body: string
): Promise<void> {
  const response = await fetch(
    `${GITHUB_API}/repos/${repo}/issues/${pullRequestNumber}/comments`,
    {
      method: 'POST',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    }
  );
  if (!response.ok) {
    console.error(`Failed to create comment: ${response.status}`);
    process.exit(1);
  }
}

export async function updateComment(
  repo: string,
  commentId: number,
  token: string,
  body: string
): Promise<void> {
  const response = await fetch(
    `${GITHUB_API}/repos/${repo}/issues/comments/${commentId}`,
    {
      method: 'PATCH',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    }
  );
  if (!response.ok) {
    console.error(`Failed to update comment: ${response.status}`);
    process.exit(1);
  }
}
