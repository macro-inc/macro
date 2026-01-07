#!/usr/bin/env bun
/**
 * Post Preview Comment to PR
 *
 * Usage:
 *   bun scripts/preview/post-comment.ts --pr 123 --repo owner/repo --token $GITHUB_TOKEN --preview-id my-feature-abc123 --sha abc1234
 */

interface Args {
  pr: number;
  repo: string;
  token: string;
  previewId: string;
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
    if (args[i] === '--preview-id' && args[i + 1]) {
      result.previewId = args[i + 1];
      i++;
    }
    if (args[i] === '--sha' && args[i + 1]) {
      result.sha = args[i + 1];
      i++;
    }
  }

  if (!result.pr || !result.repo || !result.token || !result.previewId || !result.sha) {
    console.error('Missing required arguments');
    console.error(
      'Usage: bun post-comment.ts --pr 123 --repo owner/repo --token TOKEN --preview-id ID --sha SHA'
    );
    process.exit(1);
  }

  return result as Args;
}

async function main() {
  const args = parseArgs();
  const [owner, repo] = args.repo.split('/');
  const previewUrl = `https://${args.previewId}.preview.macro.com`;
  const shortSha = args.sha.slice(0, 7);

  // Check for existing preview comment
  const commentsResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${args.pr}/comments`,
    {
      headers: {
        Authorization: `Bearer ${args.token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    }
  );

  if (!commentsResponse.ok) {
    console.error(`Failed to fetch comments: ${commentsResponse.status}`);
    process.exit(1);
  }

  const comments = (await commentsResponse.json()) as Array<{
    id: number;
    body?: string;
    user?: { type?: string };
  }>;

  const existingComment = comments.find(
    (c) => c.body?.includes('.preview.macro.com') && c.user?.type === 'Bot'
  );

  const body = `**Preview:** [${previewUrl}](${previewUrl}) (${shortSha})`;

  if (existingComment) {
    // Update existing comment
    const updateResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/comments/${existingComment.id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${args.token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      }
    );

    if (!updateResponse.ok) {
      console.error(`Failed to update comment: ${updateResponse.status}`);
      process.exit(1);
    }

    console.log('Updated existing preview comment');
  } else {
    // Create new comment
    const createResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${args.pr}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${args.token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      }
    );

    if (!createResponse.ok) {
      console.error(`Failed to create comment: ${createResponse.status}`);
      process.exit(1);
    }

    console.log('Created new preview comment');
  }

  console.log(`Preview URL: ${previewUrl}`);
}

main();
