import type { FoldedMessage } from '@service-agent-fold/generated/types';

export const DEPLOY_SESSION_ID = 'homepage-deploy-session';
export const DEPLOY_PROMPT =
  'I’ve started PR #482 to fix the flaky deploy pipeline. @Cursor, investigate the failures and build the fix on this branch.';
export const DEPLOY_RESULT = `Updated your existing PR with the deploy fix.

**Fixed** transient registry failures with bounded retries and exponential backoff.

**Verified** all 12 retry tests pass. Permanent failures still fail fast.

Ready for your review in **PR #482**.`;

/** Public, fictional fixtures. No private session data or live tool execution. */
export const DEPLOY_TRACE: FoldedMessage = {
  agentSessionId: DEPLOY_SESSION_ID,
  turn: 0,
  requestId: null,
  pending: false,
  author: { kind: 'agent' },
  stop: { kind: 'end_turn' },
  parts: [
    {
      kind: 'thought',
      text: 'Teo has already started the pull request, so I’ll work on its existing branch. First I’ll inspect the deploy logs and retry helper, then reproduce the timeout before changing the retry policy.',
    },
    {
      kind: 'text',
      text: 'I’m checking the existing branch and the failing deploy step.',
    },
    {
      kind: 'tool_use',
      id: 'inspect-branch',
      name: { kind: 'native', name: 'Bash' },
      status: 'completed',
      detail: {
        kind: 'terminal',
        command: 'git branch --show-current',
        output: 'fix/deploy-flake',
        exitCode: 0,
      },
    },
    {
      kind: 'tool_use',
      id: 'read-retry',
      name: { kind: 'native', name: 'Read' },
      status: 'completed',
      detail: {
        kind: 'read',
        paths: [
          'deploy/retry.ts',
          'deploy/retry.test.ts',
          '.github/workflows/deploy.yml',
        ],
      },
    },
    {
      kind: 'text',
      text: 'The registry occasionally returns a transient error. The deploy step currently stops after the first attempt.',
    },
    {
      kind: 'thought',
      text: 'Only transient failures should be retried. A bounded delay avoids hammering the registry, while authentication and validation failures should remain immediate errors. I’ll cover those cases in the existing tests.',
    },
    {
      kind: 'tool_use',
      id: 'edit-retry',
      name: { kind: 'native', name: 'Edit' },
      status: 'completed',
      detail: {
        kind: 'edit',
        diffs: [
          {
            path: 'deploy/retry.ts',
            oldText:
              'export async function deploy() {\n  return publish();\n}\n',
            newText:
              'export async function deploy() {\n  for (let attempt = 0; attempt < 3; attempt++) {\n    try {\n      return await publish();\n    } catch (error) {\n      if (!isTransient(error) || attempt === 2) throw error;\n      await delay(250 * 2 ** attempt);\n    }\n  }\n}\n',
          },
        ],
      },
    },
    {
      kind: 'text',
      text: 'The retry policy is in place. I’m checking success, retry limits, and permanent failures.',
    },
    {
      kind: 'tool_use',
      id: 'test-retry',
      name: { kind: 'native', name: 'Bash' },
      status: 'completed',
      detail: {
        kind: 'terminal',
        command: 'bun test deploy/retry.test.ts',
        output:
          '✓ retries transient registry errors\n✓ uses exponential backoff\n✓ stops after the retry limit\n✓ surfaces permanent failures immediately\n\n12 passed · 0 failed',
        exitCode: 0,
      },
    },
    {
      kind: 'tool_use',
      id: 'check-diff',
      name: { kind: 'native', name: 'Bash' },
      status: 'completed',
      detail: {
        kind: 'terminal',
        command: 'git diff --check',
        output: 'No whitespace errors.',
        exitCode: 0,
      },
    },
    { kind: 'text', text: DEPLOY_RESULT },
  ],
};

export const DEPLOY_PR = {
  name: 'Fix flaky deploy pipeline',
  status: 'open',
  additions: 38,
  deletions: 12,
  description: `## What changed

Retry transient registry failures with exponential backoff. Permanent failures still fail fast, and retries are capped at three attempts.

## Verification

- [x] Reproduced the intermittent failure
- [x] Covered retry limits and permanent errors
- [x] All 12 retry tests pass

Updated on Teo’s existing branch, \`fix/deploy-flake\`. Ready for review.`,
};
