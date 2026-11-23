import { describe, expect, it } from 'vitest';
import { ENTITY_CATALOG, ENTITY_VIEW, VIEW } from '../tests/fixtures';
import {
  ACTION_ORDER,
  actionPermission,
  addableEntities,
  changeForDefault,
  changeForException,
  changeForTool,
  entitiesFor,
  exceptionsFor,
  focusedAction,
  followingCount,
  groupPermissions,
  settingCounts,
  targetKey,
  toolSettingsFor,
  visiblePairs,
} from './model';

const FORWARD = { service: 'email', operation: 'forward_event' };
const SEND_MESSAGE = { service: 'email', operation: 'send_message' };

const emailSend = () => {
  const send = actionPermission(groupPermissions(VIEW, 'email'), 'send');
  if (!send) throw new Error('fixture has Email · Send');
  return send;
};

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

describe('display order', () => {
  it('lists Read, Create, Edit, Send, Delete', () => {
    expect(ACTION_ORDER).toEqual([
      'read',
      'create',
      'update',
      'send',
      'destroy',
    ]);
  });
});

describe('visible pairs', () => {
  it('lists only the actions an entity has tools for', () => {
    expect(visiblePairs(ENTITY_CATALOG)).toEqual([
      { group: 'documents', action: 'read' },
      { group: 'documents', action: 'destroy' },
      { group: 'tasks', action: 'read' },
      { group: 'email', action: 'read' },
      { group: 'email', action: 'send' },
      { group: 'channels', action: 'read' },
      { group: 'channels', action: 'send' },
      { group: 'external_chats', action: 'read' },
      { group: 'contacts', action: 'read' },
    ]);
  });

  it('gives each action the entities that have tools for it', () => {
    expect(
      entitiesFor(ENTITY_CATALOG, 'send').map((group) => group.id)
    ).toEqual(['email', 'channels']);
    expect(entitiesFor(ENTITY_CATALOG, 'create')).toEqual([]);
  });
});

describe('exceptions', () => {
  it("lists an action's exceptions in catalog order", () => {
    expect(
      exceptionsFor(ENTITY_CATALOG, ENTITY_VIEW, 'read').map((entry) => [
        entry.group.id,
        entry.state,
      ])
    ).toEqual([
      ['external_chats', 'never'],
      ['contacts', 'ask'],
    ]);
  });

  it('leaves out an exception on a pair no tool maps to', () => {
    // Tasks · Send is saved but Tasks has no Send tool.
    expect(exceptionsFor(ENTITY_CATALOG, ENTITY_VIEW, 'send')).toEqual([]);
    expect(followingCount(ENTITY_CATALOG, 'send', [])).toBe(2);
  });

  it('shows a new exception in the state it is saving to', () => {
    const pending = (target: Parameters<typeof targetKey>[0]) =>
      targetKey(target) === 'group_action:email.read' ? 'ask' : undefined;
    expect(
      exceptionsFor(ENTITY_CATALOG, ENTITY_VIEW, 'read', pending).map(
        (entry) => [entry.group.id, entry.state]
      )
    ).toEqual([
      ['email', 'ask'],
      ['external_chats', 'never'],
      ['contacts', 'ask'],
    ]);
  });

  it('counts the other entities and offers only those without one', () => {
    const exceptions = exceptionsFor(ENTITY_CATALOG, ENTITY_VIEW, 'read');
    expect(followingCount(ENTITY_CATALOG, 'read', exceptions)).toBe(4);
    expect(
      addableEntities(ENTITY_CATALOG, 'read', exceptions).map(
        (group) => group.id
      )
    ).toEqual(['documents', 'tasks', 'email', 'channels']);
  });
});

describe('changes', () => {
  it('saves a default, and clears it for Allow', () => {
    expect(changeForDefault('send', 'ask')).toEqual({
      target: { kind: 'action', action: 'send' },
      state: 'ask',
    });
    expect(changeForDefault('send', 'always')).toEqual({
      target: { kind: 'action', action: 'send' },
      state: null,
    });
  });

  it('keeps an explicit exception, and removes one with null', () => {
    expect(changeForException('channels', 'send', 'always')).toEqual({
      target: { kind: 'group_action', group: 'channels', action: 'send' },
      state: 'always',
    });
    expect(changeForException('channels', 'send', null)).toEqual({
      target: { kind: 'group_action', group: 'channels', action: 'send' },
      state: null,
    });
  });
});

describe('tool settings', () => {
  it("lists saved tool rules under their tool's action", () => {
    const send = toolSettingsFor(ENTITY_CATALOG, ENTITY_VIEW, 'send');
    expect(
      send.map((entry) => [entry.tool.operation, entry.rule.state])
    ).toEqual([['send_message', 'never']]);
    expect(toolSettingsFor(ENTITY_CATALOG, ENTITY_VIEW, 'read')).toEqual([]);
  });
});

describe('settingCounts', () => {
  it('counts only visible settings', () => {
    // Eight saved; Tasks · Send is hidden.
    expect(settingCounts(ENTITY_CATALOG, ENTITY_VIEW.rules)).toEqual({
      total: 7,
      byPerson: 6,
      byAgent: 1,
    });
  });
});

describe('focusedAction', () => {
  it("opens a linked tool's action", () => {
    expect(
      focusedAction(ENTITY_CATALOG, { group: 'email', tool: SEND_MESSAGE })
    ).toBe('send');
    expect(
      focusedAction(ENTITY_CATALOG, { group: 'email', action: 'read' })
    ).toBe('read');
    expect(focusedAction(ENTITY_CATALOG, { group: 'email' })).toBeUndefined();
  });
});
