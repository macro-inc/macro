import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { LinkShare } from '@service-storage/generated/schemas/linkShare';
import type { UpdateSharePermissionRequestV2 } from '@service-storage/generated/schemas/updateSharePermissionRequestV2';

export const NO_LINK_SHARE = 'NONE' as const;

export type LinkShareScope = LinkShare | typeof NO_LINK_SHARE;

export type LinkSharePayload = Required<
  Pick<UpdateSharePermissionRequestV2, 'linkShare' | 'linkShareAccessLevel'>
>;

type LinkShareScopeCopy = {
  label: string;
  title: string;
  description: string;
};

export type ShareStatus = {
  label: 'Public' | 'Team' | 'Shared' | 'Just me';
  tooltip: string;
};

const LINK_SHARE_SCOPE_COPY: Record<LinkShareScope, LinkShareScopeCopy> = {
  NONE: {
    label: 'None',
    title: 'Link sharing off',
    description:
      'Only people and channels you explicitly share with can access this item.',
  },
  PUBLIC: {
    label: 'Public',
    title: 'Public link',
    description: 'Anyone with the link can access this item.',
  },
  TEAM: {
    label: 'Team',
    title: 'Team link',
    description:
      "Members of the owner's team with the link can access this item. This does not share it directly with a team or channel.",
  },
};

export const LINK_SHARE_SCOPE_OPTIONS = (
  ['NONE', 'PUBLIC', 'TEAM'] as const
).map((scope) => ({
  value: scope,
  label: LINK_SHARE_SCOPE_COPY[scope].label,
}));

export function getLinkShareScope(
  linkShare: LinkShare | null | undefined
): LinkShareScope {
  return linkShare ?? NO_LINK_SHARE;
}

export function buildLinkSharePayload(
  scope: LinkShareScope,
  accessLevel?: AccessLevel | null
): LinkSharePayload {
  if (scope === NO_LINK_SHARE) {
    return {
      linkShare: null,
      linkShareAccessLevel: null,
    };
  }

  return {
    linkShare: scope,
    linkShareAccessLevel: accessLevel ?? 'view',
  };
}

export function buildLinkShareScopePayload(
  currentScope: LinkShareScope,
  nextScope: LinkShareScope,
  currentAccessLevel?: AccessLevel | null
): LinkSharePayload {
  const accessLevel =
    currentScope === NO_LINK_SHARE ? null : currentAccessLevel;
  return buildLinkSharePayload(nextScope, accessLevel);
}

export function getLinkShareScopeCopy(
  scope: LinkShareScope
): LinkShareScopeCopy {
  return LINK_SHARE_SCOPE_COPY[scope];
}

export function getShareStatus(
  linkShare: LinkShare | null | undefined,
  hasExplicitShares: boolean
): ShareStatus {
  if (linkShare === 'PUBLIC') {
    return {
      label: 'Public',
      tooltip: LINK_SHARE_SCOPE_COPY.PUBLIC.description,
    };
  }

  if (linkShare === 'TEAM') {
    return {
      label: 'Team',
      tooltip: LINK_SHARE_SCOPE_COPY.TEAM.description,
    };
  }

  if (hasExplicitShares) {
    return {
      label: 'Shared',
      tooltip: 'Shared with specific people or channels.',
    };
  }

  return {
    label: 'Just me',
    tooltip: 'Only you can access this item.',
  };
}
