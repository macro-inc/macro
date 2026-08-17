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

  it('distinguishes team links from explicit team or channel sharing', () => {
    const copy = getLinkShareScopeCopy('TEAM');

    expect(copy.title).toBe('Team link');
    expect(copy.description).toContain("Members of the owner's team");
    expect(copy.description).toContain(
      'does not share it directly with a team or channel'
    );
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
});
