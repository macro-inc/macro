import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import {
  activityCounts,
  changedFiles,
  countDiffChanges,
  latestPlan,
} from './session-summary';

function message(turn: number, parts: MessagePart[]): FoldedMessage {
  return {
    agentSessionId: 'session',
    requestId: null,
    turn,
    author: { kind: 'agent' },
    parts,
    stop: null,
  };
}

function edit(
  diffs: { path: string; oldText: string | null; newText: string }[]
): MessagePart {
  return {
    kind: 'tool_use',
    id: `edit-${diffs[0]?.path}`,
    label: 'Edit',
    status: 'completed',
    detail: { kind: 'edit', diffs },
    rawInput: null,
    rawOutput: null,
  };
}

function tool(detail: Extract<MessagePart, { kind: 'tool_use' }>['detail']) {
  return {
    kind: 'tool_use' as const,
    id: 'tool',
    label: 'Tool',
    status: 'completed' as const,
    detail,
    rawInput: null,
    rawOutput: null,
  };
}

describe('countDiffChanges', () => {
  it('sums added and removed lines across diffs', () => {
    const { additions, deletions } = countDiffChanges([
      { oldText: 'a\nb\n', newText: 'a\nc\nd\n' },
      { oldText: null, newText: 'new\n' },
    ]);
    expect(additions).toBe(3); // c, d, new
    expect(deletions).toBe(1); // b
  });
});

describe('latestPlan', () => {
  it('returns the last plan in the transcript — later plans replace earlier', () => {
    const early: MessagePart = {
      kind: 'plan',
      entries: [{ content: 'old', priority: 'medium', status: 'pending' }],
    };
    const late: MessagePart = {
      kind: 'plan',
      entries: [{ content: 'new', priority: 'high', status: 'in_progress' }],
    };
    const plan = latestPlan([message(0, [early]), message(1, [late])]);
    expect(plan?.[0]?.content).toBe('new');
  });

  it('is undefined when no turn ever produced a plan', () => {
    expect(latestPlan([message(0, [{ kind: 'text', text: 'hi' }])])).toBe(
      undefined
    );
  });
});

describe('changedFiles', () => {
  it('sums stats per path across edits, in first-touched order', () => {
    const messages = [
      message(0, [
        edit([{ path: 'a.ts', oldText: 'x\n', newText: 'x\ny\n' }]),
        edit([{ path: 'b.ts', oldText: null, newText: 'one\ntwo\n' }]),
      ]),
      message(1, [edit([{ path: 'a.ts', oldText: 'y\n', newText: 'z\n' }])]),
    ];
    expect(changedFiles(messages)).toEqual([
      { path: 'a.ts', additions: 2, deletions: 1 },
      { path: 'b.ts', additions: 2, deletions: 0 },
    ]);
  });

  it('ignores non-edit tools', () => {
    const messages = [message(0, [tool({ kind: 'read', paths: ['a.ts'] })])];
    expect(changedFiles(messages)).toEqual([]);
  });
});

describe('activityCounts', () => {
  it('counts tool calls by kind, keeping zero-count items', () => {
    const messages = [
      message(0, [
        tool({ kind: 'read', paths: ['a.ts'] }),
        tool({ kind: 'read', paths: ['b.ts'] }),
        tool({ kind: 'search', paths: [], output: null }),
        tool({ kind: 'terminal', command: 'ls', output: '', exitCode: 0 }),
      ]),
    ];
    const byKey = Object.fromEntries(
      activityCounts(messages).map((item) => [item.key, item.count])
    );
    expect(byKey).toEqual({
      edit: 0,
      read: 2,
      search: 1,
      terminal: 1,
      fetch: 0,
    });
  });
});
