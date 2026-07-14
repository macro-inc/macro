#!/usr/bin/env bun
/**
 * Get or Create Preview ID
 *
 * For CI: Checks PR comments for existing preview URL, or generates new ID
 * For local: Just generates a new ID based on branch name
 *
 * Usage:
 *   bun scripts/preview/get-or-create-id.ts
 *   bun scripts/preview/get-or-create-id.ts --pr 123 --repo owner/repo --token $GITHUB_TOKEN
 *
 * Output: Prints the preview ID to stdout
 */

import { execSync } from 'node:child_process';

interface Args {
  pr?: number;
  repo?: string;
  token?: string;
  branch?: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pr' && args[i + 1]) {
      result.pr = parseInt(args[i + 1], 10);
      i++;
    }
    if (args[i] === '--repo' && args[i + 1]) {
      result.repo = args[i + 1];
      i++;
    }
    if (args[i] === '--token' && args[i + 1]) {
      result.token = args[i + 1];
      i++;
    }
    if (args[i] === '--branch' && args[i + 1]) {
      result.branch = args[i + 1];
      i++;
    }
  }

  return result;
}

export function generatePreviewId(branchOverride?: string): string {
  let branch = branchOverride;

  if (!branch) {
    try {
      branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    } catch {
      branch = '';
    }
  }

  if (!branch) {
    branch = 'preview';
  }

  const sanitized = branch
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);

  const nanoid = Math.random().toString(36).slice(2, 8);
  return `${sanitized}-${nanoid}`;
}

export const PREVIEW_URL_REGEX = /https:\/\/([a-z0-9-]+)\.preview\.macro\.com/;

export function extractPreviewIdFromBody(body: string): string | null {
  const match = body.match(PREVIEW_URL_REGEX);
  return match?.[1] ?? null;
}

async function getExistingPreviewId(pr: number, repo: string, token: string): Promise<string | null> {
  const [owner, repoName] = repo.split('/');

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/issues/${pr}/comments`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    }
  );

  if (!response.ok) {
    console.error(`Failed to fetch PR comments: ${response.status}`);
    return null;
  }

  const comments = (await response.json()) as Array<{ body?: string; user?: { type?: string } }>;

  const previewComment = comments.find(
    (c) => c.body?.includes('.preview.macro.com') && c.user?.type === 'Bot'
  );

  if (previewComment?.body) {
    return extractPreviewIdFromBody(previewComment.body);
  }

  return null;
}

async function main() {
  const args = parseArgs();

  // If we have PR info, try to get existing preview ID
  if (args.pr && args.repo && args.token) {
    const existingId = await getExistingPreviewId(args.pr, args.repo, args.token);
    if (existingId) {
      console.log(existingId);
      return;
    }
  }

  console.log(generatePreviewId(args.branch));
}

if (import.meta.main) {
  main();
}
