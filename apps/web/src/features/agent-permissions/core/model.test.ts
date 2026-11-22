import { describe, expect, it } from 'vitest';
import { CATALOG, VIEW } from '../tests/fixtures';
import {
  actionPermission,
  changeForTool,
  groupPermissions,
  groupSummary,
  isVisibleTarget,
  matchRange,
  restrictionCount,
  restrictions,
  searchPermissions,
  settingCounts,
  toolState,
  visibleActions,
  visibleGroups,
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
    // Its saved Never on Send, which no tool has, doesn't count.
    expect(
      groupSummary(documents, groupPermissions(VIEW, 'documents'), VIEW.rules)
    ).toMatchObject({
      everything: 'always',
      asks: [],
      nevers: [],
      customTools: 0,
      byAgent: false,
    });
  });

  it('ignores an action with no tools even when a view lists it', () => {
    const documents = CATALOG.groups[1];
    const group = groupPermissions(VIEW, 'documents');
    if (!group) throw new Error('fixture has Documents');
    const withSend = {
      ...group,
      actions: [
        ...group.actions,
        {
          action: 'send' as const,
          state: 'never' as const,
          origin: 'group_action' as const,
          tools: 0,
          overrides: [],
        },
      ],
    };
    expect(groupSummary(documents, withSend, VIEW.rules)).toMatchObject({
      everything: 'always',
      nevers: [],
    });
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

describe('visible targets', () => {
  it('shows only groups and actions some tool has', () => {
    expect(visibleGroups(CATALOG).map((group) => group.id)).toEqual([
      'email',
      'documents',
    ]);
    expect(visibleActions(CATALOG.groups[0])).toEqual(['read', 'send']);
    expect(visibleActions(CATALOG.groups[2])).toEqual([]);
  });

  it('knows a rule on an action no tool has is hidden', () => {
    const [emailSend, forward, documentsSend] = VIEW.rules.map(
      (rule) => rule.target
    );
    expect(isVisibleTarget(CATALOG, emailSend)).toBe(true);
    expect(isVisibleTarget(CATALOG, forward)).toBe(true);
    expect(isVisibleTarget(CATALOG, documentsSend)).toBe(false);
    expect(
      isVisibleTarget(CATALOG, {
        kind: 'group_action',
        group: 'tasks',
        action: 'read',
      })
    ).toBe(false);
    expect(
      isVisibleTarget(CATALOG, {
        kind: 'tool',
        service: 'tasks',
        operation: 'gone',
      })
    ).toBe(false);
  });
});

describe('counts', () => {
  it('counts shown settings, agent-set ones and tool rules', () => {
    // The hidden Documents · Send is saved (Reset clears it) but not shown.
    expect(settingCounts(CATALOG, VIEW.rules)).toEqual({
      saved: 3,
      total: 2,
      byPerson: 1,
      byAgent: 1,
      tools: 1,
      reset: { byAgent: 1, tools: 1 },
    });
  });

  it('has something to reset when only hidden settings are saved', () => {
    const hidden = VIEW.rules.filter(
      (rule) => !isVisibleTarget(CATALOG, rule.target)
    );
    expect(settingCounts(CATALOG, hidden)).toMatchObject({
      saved: 1,
      total: 0,
      byPerson: 0,
    });
  });

  it('counts restricted actions and differing tools', () => {
    // Forward calendar event is allowed under Send's Ask: not a restriction.
    expect(restrictionCount(VIEW)).toBe(1);
    expect(restrictions(CATALOG, VIEW)).toEqual([
      { group: 'email', action: 'send', state: 'ask' },
    ]);
  });

  it('counts no restriction on an action with no tools', () => {
    const view = {
      ...VIEW,
      groups: [
        ...VIEW.groups,
        {
          group: 'tasks',
          actions: [
            {
              action: 'send' as const,
              state: 'never' as const,
              origin: 'group_action' as const,
              tools: 0,
              overrides: [],
            },
          ],
        },
      ],
    };
    expect(restrictionCount(view)).toBe(1);
    expect(restrictions(CATALOG, view)).toHaveLength(1);
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

  it('never lists a group with no tools', () => {
    expect(searchPermissions(CATALOG, 'tasks').groupCount).toBe(0);
  });
});

describe('matchRange', () => {
  it('locates the query case-insensitively', () => {
    expect(matchRange('Send message', 'MESS')).toEqual({ start: 5, end: 9 });
    expect(matchRange('Send message', '  ')).toBeUndefined();
  });
});
