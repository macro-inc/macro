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

  it('does not imply disabling links removes other access', () => {
    expect(getLinkShareScopeCopy('NONE').description).toBe(
      'Link access is disabled. Existing team, people, channel, and inherited access is unchanged.'
    );
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
  it.each(['view', 'comment', 'edit'] as const)(
    'shows explicit team %s access with link sharing off',
    (teamShareAccessLevel) => {
      expect(
        getShareStatus({
          linkShare: null,
          teamShareAccessLevel,
          hasPeopleOrChannelShares: false,
        })
      ).toEqual({
        label: 'Team',
        tooltip: "Shared directly with the owner's team.",
      });
    }
  );

  it('keeps public link status while acknowledging team and recipient grants', () => {
    expect(
      getShareStatus({
        linkShare: 'PUBLIC',
        teamShareAccessLevel: 'comment',
        hasPeopleOrChannelShares: true,
      })
    ).toEqual({
      label: 'Public',
      tooltip:
        "Anyone with the link can access this item. Shared directly with the owner's team. Shared with specific people or channels.",
    });
  });

  it.each([null, undefined])(
    'describes a team link without explicit team grants (%s) as link access',
    (teamShareAccessLevel) => {
      expect(
        getShareStatus({
          linkShare: 'TEAM',
          teamShareAccessLevel,
          hasPeopleOrChannelShares: false,
        })
      ).toEqual({
        label: 'Team',
        tooltip: getLinkShareScopeCopy('TEAM').description,
      });
    }
  );

  it('acknowledges both team-link access and explicit team sharing', () => {
    const status = getShareStatus({
      linkShare: 'TEAM',
      teamShareAccessLevel: 'view',
      hasPeopleOrChannelShares: false,
    });
    expect(status.label).toBe('Team');
    expect(status.tooltip).toContain('with the link');
    expect(status.tooltip).toContain("Shared directly with the owner's team.");
  });

  it.each([null, undefined])(
    'preserves people/channel status when explicit team access is %s',
    (teamShareAccessLevel) => {
      expect(
        getShareStatus({
          linkShare: null,
          teamShareAccessLevel,
          hasPeopleOrChannelShares: true,
        })
      ).toEqual({
        label: 'Shared',
        tooltip: 'Shared with specific people or channels.',
      });
    }
  );

  it.each([null, undefined])(
    'does not treat explicit team %s as proof of privacy',
    (teamShareAccessLevel) => {
      expect(
        getShareStatus({
          linkShare: null,
          teamShareAccessLevel,
          hasPeopleOrChannelShares: false,
        })
      ).toEqual({
        label: 'Link off',
        tooltip:
          'Link sharing is off. Access through teams, people, channels, or parent folders may still apply.',
      });
    }
  );

  it('handles absent legacy response fields without claiming privacy', () => {
    const status = getShareStatus({
      linkShare: undefined,
      hasPeopleOrChannelShares: false,
    });
    expect(status.label).toBe('Link off');
    expect(status.tooltip).toContain('may still apply');
  });
});
