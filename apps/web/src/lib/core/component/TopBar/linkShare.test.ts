import { describe, expect, it } from 'vitest';
import {
  buildLinkSharePayload,
  buildLinkShareScopePayload,
  getLinkShareScope,
  getLinkShareScopeCopy,
  getShareStatus,
  LINK_SHARE_SCOPE_OPTIONS,
} from './linkShare';

describe('getLinkShareScope', () => {
  it.each([null, undefined])('maps %s to NONE', (linkShare) => {
    expect(getLinkShareScope(linkShare)).toBe('NONE');
  });

  it.each(['PUBLIC', 'TEAM'] as const)('preserves %s', (linkShare) => {
    expect(getLinkShareScope(linkShare)).toBe(linkShare);
  });
});

describe('buildLinkSharePayload', () => {
  it('clears the scope and access level when link sharing is disabled', () => {
    expect(buildLinkSharePayload('NONE', 'edit')).toEqual({
      linkShare: null,
      linkShareAccessLevel: null,
    });
  });

  it.each(['PUBLIC', 'TEAM'] as const)(
    'defaults a newly enabled %s link to view access',
    (scope) => {
      expect(buildLinkSharePayload(scope, null)).toEqual({
        linkShare: scope,
        linkShareAccessLevel: 'view',
      });
    }
  );

  it('keeps the selected access level independent from the link scope', () => {
    expect(buildLinkSharePayload('TEAM', 'edit')).toEqual({
      linkShare: 'TEAM',
      linkShareAccessLevel: 'edit',
    });
  });
});

describe('buildLinkShareScopePayload', () => {
  it('uses view when enabling a new link even if a stale access level exists', () => {
    expect(buildLinkShareScopePayload('NONE', 'PUBLIC', 'edit')).toEqual({
      linkShare: 'PUBLIC',
      linkShareAccessLevel: 'view',
    });
  });

  it('preserves the access level when switching an enabled link scope', () => {
    expect(buildLinkShareScopePayload('PUBLIC', 'TEAM', 'edit')).toEqual({
      linkShare: 'TEAM',
      linkShareAccessLevel: 'edit',
    });
  });
});

describe('link share copy', () => {
  it('provides None, Public, and Team selector options', () => {
    expect(LINK_SHARE_SCOPE_OPTIONS).toEqual([
      { value: 'NONE', label: 'None' },
      { value: 'PUBLIC', label: 'Public' },
      { value: 'TEAM', label: 'Team' },
    ]);
  });

  it('explains public links', () => {
    expect(getLinkShareScopeCopy('PUBLIC')).toEqual({
      label: 'Public',
      title: 'Public link',
      description: 'Anyone with the link can access this item.',
    });
  });

  it('points team links at the explicit team share in People with access', () => {
    expect(getLinkShareScopeCopy('TEAM')).toEqual({
      label: 'Team',
      title: 'Team link',
      description:
        "Members of the owner's team with the link can access this item. To share it with the whole team, use the Team row under People with access.",
    });
  });
});

describe('getShareStatus', () => {
  it.each([
    ['PUBLIC', true, 'Public'],
    ['TEAM', true, 'Team'],
    [null, true, 'Shared'],
    [null, false, 'Just me'],
  ] as const)(
    'uses %s with explicit shares %s for the %s status',
    (linkShare, hasExplicitShares, expectedLabel) => {
      expect(getShareStatus(linkShare, hasExplicitShares).label).toBe(
        expectedLabel
      );
    }
  );

  it('uses link-specific tooltip copy for team links', () => {
    expect(getShareStatus('TEAM', false).tooltip).toBe(
      getLinkShareScopeCopy('TEAM').description
    );
  });

  it.each([
    ['PUBLIC', false, 'Public'],
    ['TEAM', false, 'Team'],
    [null, false, 'Shared'],
    [null, true, 'Shared'],
  ] as const)(
    'keeps the %s link label over an explicit team share (channels: %s) and otherwise reads %s',
    (linkShare, hasExplicitShares, expectedLabel) => {
      expect(getShareStatus(linkShare, hasExplicitShares, true).label).toBe(
        expectedLabel
      );
    }
  );

  it('describes a team-only share without mentioning channels', () => {
    expect(getShareStatus(null, false, true)).toEqual({
      label: 'Shared',
      tooltip: "Shared with everyone on the owner's team.",
    });
  });

  it('describes a team share alongside channel shares', () => {
    expect(getShareStatus(null, true, true).tooltip).toBe(
      "Shared with everyone on the owner's team and specific people or channels."
    );
  });

  it('defaults to no team share', () => {
    expect(getShareStatus(null, true)).toEqual(
      getShareStatus(null, true, false)
    );
  });
});
