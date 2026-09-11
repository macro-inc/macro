#!/usr/bin/env bun
/**
 * Post (or update) the iOS preview comment on a PR.
 *
 * Deliberately a separate comment from the web preview's: that one is found by
 * `body.includes('.preview.macro.com')` and has its preview id scraped back out
 * of the body, so adding to it would break `get-or-create-id.ts`.
 *
 * Usage:
 *   bun scripts/ios-preview/post-ios-comment.ts \
 *     --pr 123 --repo owner/repo --token $GITHUB_TOKEN \
 *     --public-key abc123 --branch wolf/thing --sha abc1234567
 */

import { buildIosCommentBody, findIosPreviewComment } from './appetize';
import { createComment, fetchIssueComments, updateComment } from './github';

interface Args {
  pr: number;
  repo: string;
  token: string;
  publicKey: string;
  branch: string;
  sha: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Partial<Args> = {};

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
    if (args[i] === '--public-key' && args[i + 1]) {
      result.publicKey = args[i + 1];
      i++;
    }
    if (args[i] === '--branch' && args[i + 1]) {
      result.branch = args[i + 1];
      i++;
    }
    if (args[i] === '--sha' && args[i + 1]) {
      result.sha = args[i + 1];
      i++;
    }
  }

  if (
    !result.pr ||
    !result.repo ||
    !result.token ||
    !result.publicKey ||
    !result.branch ||
    !result.sha
  ) {
    console.error(
      'Usage: post-ios-comment.ts --pr N --repo owner/repo --token T --public-key K --branch B --sha S'
    );
    process.exit(1);
  }

  return result as Args;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const body = buildIosCommentBody({
    publicKey: args.publicKey,
    branchName: args.branch,
    commitSha: args.sha,
  });

  const comments = await fetchIssueComments(args.repo, args.pr, args.token);
  const existing = findIosPreviewComment(comments);

  if (existing) {
    await updateComment(args.repo, existing.id, args.token, body);
    console.log('Updated existing iOS preview comment');
  } else {
    await createComment(args.repo, args.pr, args.token, body);
    console.log('Created iOS preview comment');
  }
}

if (import.meta.main) {
  main();
}
