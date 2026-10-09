import { describe, expect, it } from 'vitest';
import { detectPrOrigin, toolForHarness } from './pr-origin';

describe('detectPrOrigin', () => {
  it('prefers the Macro agent session that opened the pull request', () => {
    expect(
      detectPrOrigin({
        description: 'https://claude.ai/code/session_123',
        sessions: [
          { id: 'linked', source: 'user', harness: 'cursor' },
          { id: 'opener', source: 'agent', harness: 'codex-cloud' },
        ],
      })
    ).toEqual({ tool: 'codex', signal: 'agent-session', sessionId: 'opener' });
  });

  it.each([
    [
      'Summary\n\nhttps://claude.ai/code/session_014v5t2656hDgbY8N9VFDZsN',
      'claude',
      'https://claude.ai/code/session_014v5t2656hDgbY8N9VFDZsN',
    ],
    [
      'Codex Task: https://chatgpt.com/codex/tasks/task_e_68a1b2',
      'codex',
      'https://chatgpt.com/codex/tasks/task_e_68a1b2',
    ],
    [
      '[Open in Cursor](https://cursor.com/agents?id=bc-123abc)',
      'cursor',
      'https://cursor.com/agents?id=bc-123abc',
    ],
    [
      'Devin run: https://app.devin.ai/sessions/0a1b2c3d',
      'devin',
      'https://app.devin.ai/sessions/0a1b2c3d',
    ],
    [
      'From https://macro.com/app/agent/0198a4cc-e138-7670',
      'macro',
      'https://macro.com/app/agent/0198a4cc-e138-7670',
    ],
  ] as const)('reads a session link in %j', (description, tool, url) => {
    expect(detectPrOrigin({ description })).toEqual({
      tool,
      signal: 'session-link',
      url,
    });
  });

  it('reads footers and trailers without a link', () => {
    expect(
      detectPrOrigin({
        description:
          '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
      })
    ).toEqual({ tool: 'claude', signal: 'description' });
    expect(
      detectPrOrigin({
        description: 'Co-Authored-By: Claude <noreply@anthropic.com>',
      })
    ).toEqual({ tool: 'claude', signal: 'description' });
  });

  it('falls back to the bot author, then the branch name', () => {
    expect(
      detectPrOrigin({ authorLogin: 'Copilot', headBranch: 'claude/x' })
    ).toEqual({ tool: 'copilot', signal: 'author' });
    expect(
      detectPrOrigin({ authorLogin: 'devin-ai-integration[bot]' })
    ).toEqual({ tool: 'devin', signal: 'author' });
    expect(detectPrOrigin({ headBranch: 'cursor/fix-login-1a2b' })).toEqual({
      tool: 'cursor',
      signal: 'branch',
    });
    expect(detectPrOrigin({ headBranch: 'codex/add-filters' })).toEqual({
      tool: 'codex',
      signal: 'branch',
    });
  });

  it('finds nothing for a pull request a person opened by hand', () => {
    expect(
      detectPrOrigin({
        description: 'Fixes the claude.ai settings page copy.',
        authorLogin: 'octocat',
        headBranch: 'octocat/fix-copy',
      })
    ).toBeUndefined();
  });
});

describe('toolForHarness', () => {
  it.each([
    ['claude-code', 'claude'],
    ['claude-cloud', 'claude'],
    ['codex-cloud', 'codex'],
    ['cursor', 'cursor'],
    ['macrod', 'macro'],
    [undefined, 'macro'],
  ] as const)('maps %s to %s', (harness, tool) => {
    expect(toolForHarness(harness)).toBe(tool);
  });
});
