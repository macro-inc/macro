import { describe, expect, it } from 'vitest';
import { CATALOG, VIEW } from '../tests/fixtures';
import {
  actionPermission,
  changeForTool,
  groupPermissions,
  groupSummary,
  matchRange,
  restrictionCount,
  restrictions,
  searchPermissions,
  settingCounts,
  toolState,
} from './model';

const emailSend = () => {
  const send = actionPermission(groupPermissions(VIEW, 'email'), 'send');
  if (!send) throw new Error('fixture has Email · Send');
  return send;
};

const FORWARD = { service: 'email', operation: 'forward_event' };
const SEND_MESSAGE = { service: 'email', operation: 'send_message' };

describe('toolState', () => {
  it('uses the override when the tool differs, else the action state', () => {
    expect(toolState(emailSend(), FORWARD)).toBe('always');
    expect(toolState(emailSend(), SEND_MESSAGE)).toBe('ask');
  });
});

describe('changeForTool', () => {
  it('clears the rule when the tool is set to its action state', () => {
    expect(changeForTool(emailSend().state, FORWARD, 'ask')).toEqual({
      target: { kind: 'tool', service: 'email', operation: 'forward_event' },
      state: null,
    });
  });

  it('saves a rule when the tool differs from its action', () => {
    expect(changeForTool(emailSend().state, SEND_MESSAGE, 'never')).toEqual({
      target: { kind: 'tool', service: 'email', operation: 'send_message' },
      state: 'never',
    });
  });
});

describe('groupSummary', () => {
  it('lists asks, nevers, customized tools and agent restrictions', () => {
    const email = CATALOG.groups[0];
    expect(
      groupSummary(email, groupPermissions(VIEW, 'email'), VIEW.rules)
    ).toEqual({
      toolCount: 3,
      asks: ['send'],
      nevers: [],
      customTools: 1,
      byAgent: true,
      sessionLimited: false,
    });
  });

  it('says nothing is restricted in an untouched group', () => {
    const documents = CATALOG.groups[1];
    expect(
      groupSummary(documents, groupPermissions(VIEW, 'documents'), VIEW.rules)
    ).toMatchObject({ asks: [], nevers: [], customTools: 0, byAgent: false });
  });

  it('notices a limit set for the session only', () => {
    const email = CATALOG.groups[0];
    const group = groupPermissions(VIEW, 'email');
    if (!group) throw new Error('fixture has Email');
    const limited = {
      ...group,
      actions: group.actions.map((action) =>
        action.action === 'read'
          ? { ...action, state: 'never' as const, origin: 'session' as const }
          : action
      ),
    };
    expect(groupSummary(email, limited, [])).toMatchObject({
      nevers: ['read'],
      sessionLimited: true,
    });
  });

  it('says once what every action with tools agrees on', () => {
    const email = CATALOG.groups[0];
    const group = groupPermissions(VIEW, 'email');
    if (!group) throw new Error('fixture has Email');
    // Email has tools for Read and Send only; Create stays Always allow.
    const asking = {
      ...group,
      actions: group.actions.map((action) =>
        action.action === 'read' ? { ...action, state: 'ask' as const } : action
      ),
    };
    expect(groupSummary(email, asking, []).everything).toBe('ask');
    expect(
      groupSummary(email, groupPermissions(VIEW, 'email'), []).everything
    ).toBeUndefined();
  });
});

describe('counts', () => {
  it('counts saved settings, agent-set ones and tool rules', () => {
    expect(settingCounts(VIEW.rules)).toEqual({
      total: 2,
      byPerson: 1,
      byAgent: 1,
      tools: 1,
    });
  });

  it('counts restricted actions and differing tools', () => {
    // Forward calendar event is allowed under Send's Ask: not a restriction.
    expect(restrictionCount(VIEW)).toBe(1);
    expect(restrictions(CATALOG, VIEW)).toEqual([
      { group: 'email', action: 'send', state: 'ask' },
    ]);
  });
});

describe('searchPermissions', () => {
  it('shows a whole group when its name matches', () => {
    const result = searchPermissions(CATALOG, 'EMAIL');
    expect(result.groups.email).toEqual({ all: true, actions: [], tools: [] });
    expect(result.groupCount).toBe(1);
    expect(result.toolCount).toBe(3);
  });

  it('matches action names, tool labels and service.operation', () => {
    const result = searchPermissions(CATALOG, 'send');
    expect(result.groups.email).toEqual({
      all: false,
      actions: ['send'],
      tools: ['email.send_message'],
    });
    expect(result.groups.documents).toBeUndefined();
    expect(result.toolCount).toBe(1);

    expect(searchPermissions(CATALOG, 'delete').groups.documents).toEqual({
      all: false,
      actions: ['destroy'],
      tools: ['storage.delete_document'],
    });
    expect(
      searchPermissions(CATALOG, 'storage.delete').groups.documents?.tools
    ).toEqual(['storage.delete_document']);
  });

  it('finds nothing for an unrelated query', () => {
    expect(searchPermissions(CATALOG, 'zebra').groupCount).toBe(0);
  });
});

describe('matchRange', () => {
  it('locates the query case-insensitively', () => {
    expect(matchRange('Send message', 'MESS')).toEqual({ start: 5, end: 9 });
    expect(matchRange('Send message', '  ')).toBeUndefined();
  });
});
