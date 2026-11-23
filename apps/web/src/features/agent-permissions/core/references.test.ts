import { describe, expect, it } from 'vitest';
import {
  CANDIDATES,
  ENTITY_CATALOG,
  ENTITY_VIEW,
  FOLLOWING_VIEW,
} from '../tests/fixtures';
import { actionPermission, defaultFor, groupPermissions } from './model';
import {
  applyChanges,
  blankView,
  defaultCandidate,
  followerExceptionRules,
  latestChanges,
} from './references';

const pair = (
  view: typeof ENTITY_VIEW,
  group: string,
  action: 'read' | 'send'
) => actionPermission(groupPermissions(view, group), action);

describe('applyChanges', () => {
  it('moves every entity without an exception to a new default', () => {
    const view = applyChanges(ENTITY_VIEW, [
      { target: { kind: 'action', action: 'read' }, state: 'ask' },
    ]);
    expect(defaultFor(view, 'read')).toBe('ask');
    expect(pair(view, 'email', 'read')?.state).toBe('ask');
    // Exceptions keep their own state.
    expect(pair(view, 'contacts', 'read')).toMatchObject({
      state: 'ask',
      exception: true,
    });
    expect(pair(view, 'external_chats', 'read')).toMatchObject({
      state: 'never',
      exception: true,
    });
  });

  it('adds an exception in any state and removes one with null', () => {
    const view = applyChanges(ENTITY_VIEW, [
      {
        target: { kind: 'group_action', group: 'email', action: 'read' },
        state: 'always',
      },
      {
        target: { kind: 'group_action', group: 'contacts', action: 'read' },
        state: null,
      },
    ]);
    expect(pair(view, 'email', 'read')).toMatchObject({
      state: 'always',
      exception: true,
    });
    expect(pair(view, 'contacts', 'read')).toMatchObject({
      state: 'always',
      exception: false,
    });
    expect(
      view.rules.some(
        (rule) =>
          rule.target.kind === 'group_action' &&
          rule.target.group === 'contacts'
      )
    ).toBe(false);
  });

  it('saves no rule for an Allow default', () => {
    const view = applyChanges(ENTITY_VIEW, [
      { target: { kind: 'action', action: 'send' }, state: 'always' },
    ]);
    expect(defaultFor(view, 'send')).toBe('always');
    expect(
      view.rules.some(
        (rule) => rule.target.kind === 'action' && rule.target.action === 'send'
      )
    ).toBe(false);
  });
});

describe('latestChanges', () => {
  it("keeps each target's last change", () => {
    expect(
      latestChanges([
        { target: { kind: 'action', action: 'read' }, state: 'ask' },
        { target: { kind: 'action', action: 'send' }, state: 'never' },
        { target: { kind: 'action', action: 'read' }, state: null },
      ])
    ).toEqual([
      { target: { kind: 'action', action: 'read' }, state: null },
      { target: { kind: 'action', action: 'send' }, state: 'never' },
    ]);
  });
});

describe('blankView', () => {
  it('allows every action with no exceptions, for pairs with tools', () => {
    const view = blankView(ENTITY_CATALOG);
    expect(view.defaults.every((entry) => entry.state === 'always')).toBe(true);
    expect(view.rules).toEqual([]);
    expect(
      groupPermissions(view, 'tasks')?.actions.map((a) => a.action)
    ).toEqual(['read']);
  });
});

describe('defaultCandidate', () => {
  it('preselects personal Macro for a private agent', () => {
    expect(defaultCandidate(CANDIDATES, 'Private')?.policyId).toBe(
      'policy-macro'
    );
  });

  it('preselects the team default for a team agent when listed', () => {
    expect(defaultCandidate(CANDIDATES, 'Team')).toBeUndefined();
    expect(
      defaultCandidate(
        [
          ...CANDIDATES,
          {
            policyId: 'policy-team',
            kind: 'team',
            team: { id: 'team-1', name: 'Acme' },
            scope: { kind: 'team', teamId: 'team-1', teamName: 'Acme' },
            current: false,
          },
        ],
        'Team'
      )?.policyId
    ).toBe('policy-team');
  });
});

describe('followerExceptionRules', () => {
  it("lists inherited exceptions and the follower's own", () => {
    expect(
      followerExceptionRules(FOLLOWING_VIEW).map((rule) =>
        rule.target.kind === 'group_action'
          ? `${rule.target.group}.${rule.target.action}`
          : ''
      )
    ).toEqual([
      'contacts.read',
      'external_chats.read',
      'tasks.send',
      'email.read',
    ]);
  });
});
