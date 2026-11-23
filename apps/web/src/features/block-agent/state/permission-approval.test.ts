import type { MessagePart } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import {
  isShowPermissions,
  parseExecutionPermission,
  parsePermissionHold,
  parseShowPermissions,
} from './permission-approval';
import { isPermissionBlocked, segmentParts } from './tool-groups';

const SEND = {
  service: 'email',
  operation: 'send_message',
  label: 'Send message',
  group: 'email',
  groupName: 'Email',
  action: 'send',
  state: 'ask',
  origin: 'group_action',
};

type ToolUsePart = Extract<MessagePart, { kind: 'tool_use' }>;

function internalCall(
  tool: string,
  detail: { input?: unknown; result?: unknown }
): ToolUsePart {
  return {
    kind: 'tool_use',
    id: `${tool}-1`,
    name: { kind: 'mcp', server: 'macro_internal', tool },
    status: 'completed',
    detail: {
      kind: 'other',
      acpKind: 'other',
      input: detail.input ?? null,
      output: null,
      result: detail.result ?? null,
      error: null,
    },
  };
}

const EXECUTION_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('parsePermissionHold', () => {
  it('reads the program and the operations it asks about', () => {
    const source = 'await tools.email.send_message({ body: {} })';
    expect(
      parsePermissionHold({
        source,
        permission: {
          executionId: EXECUTION_ID,
          language: 'js_tools',
          operations: [SEND],
        },
      })
    ).toEqual({ source, operations: [SEND] });
  });

  it('is not a permission hold without operations', () => {
    expect(parsePermissionHold({ path: '/x' })).toBeUndefined();
    expect(parsePermissionHold(null)).toBeUndefined();
  });
});

describe('parseExecutionPermission', () => {
  it('reads a blocked and a declined program', () => {
    expect(
      parseExecutionPermission({ outcome: 'blocked', operations: [SEND] })
    ).toEqual({ outcome: 'blocked', operations: [SEND] });
    expect(
      parseExecutionPermission({
        outcome: 'declined',
        status: 'expired',
        operations: [SEND],
      })?.outcome
    ).toBe('declined');
  });

  it('ignores an outcome this build does not know', () => {
    expect(
      parseExecutionPermission({ outcome: 'later', operations: [] })
    ).toBeUndefined();
    expect(parseExecutionPermission(null)).toBeUndefined();
  });
});

describe('ShowPermissions calls', () => {
  it('is only the internal server’s ShowPermissions', () => {
    expect(isShowPermissions(internalCall('ShowPermissions', {}))).toBe(true);
    expect(
      isShowPermissions({
        ...internalCall('ShowPermissions', {}),
        name: {
          kind: 'mcp' as const,
          server: 'macro',
          tool: 'ShowPermissions',
        },
      })
    ).toBe(false);
  });

  it('prefers the server’s normalized selection over the agent’s arguments', () => {
    const part = internalCall('ShowPermissions', {
      input: { groups: [{ group: 'email' }], reason: 'asked' },
      result: {
        agentId: 'agent-1',
        sessionId: 'session-1',
        selection: {
          groups: [{ group: 'email', actions: ['send'] }],
          tools: [],
        },
        reason: 'answered',
        current: [],
        message: '',
      },
    });
    expect(parseShowPermissions(part)).toEqual({
      selection: { groups: [{ group: 'email', actions: ['send'] }], tools: [] },
      reason: 'answered',
      agentId: 'agent-1',
    });
  });

  it('falls back to the arguments before the server answered', () => {
    const part = internalCall('ShowPermissions', {
      input: { tools: [{ service: 'email', operation: 'send_message' }] },
    });
    expect(parseShowPermissions(part)?.selection).toEqual({
      groups: [],
      tools: [{ service: 'email', operation: 'send_message' }],
    });
  });
});

describe('grouping permission cards', () => {
  const blocked = internalCall('ExecuteCode', {
    input: { source: 'let () = ()' },
    result: {
      executionId: EXECUTION_ID,
      status: 'failed',
      permission: {
        outcome: 'blocked',
        operations: [{ ...SEND, state: 'never' }],
      },
    },
  });
  const ordinary = internalCall('ExecuteCode', {
    input: { source: 'let () = ()' },
    result: { executionId: EXECUTION_ID, status: 'succeeded' },
  });

  it('knows a blocked program from its receipt', () => {
    expect(isPermissionBlocked(blocked)).toBe(true);
    expect(isPermissionBlocked(ordinary)).toBe(false);
  });

  it('keeps a blocked program and a ShowPermissions card out of tool groups', () => {
    const show = internalCall('ShowPermissions', {
      input: { groups: [{ group: 'email' }] },
    });
    expect(segmentParts([ordinary, blocked, ordinary, show])).toEqual([
      { kind: 'tools', start: 0, end: 1 },
      { kind: 'part', start: 1, end: 2 },
      { kind: 'tools', start: 2, end: 3 },
      { kind: 'part', start: 3, end: 4 },
    ]);
  });
});
