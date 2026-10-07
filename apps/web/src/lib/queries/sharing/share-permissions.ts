import type { ShareItemType } from '@core/component/TopBar/linkShare';
import { throwOnErr } from '@core/util/result';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import { fetchAgentSessionSharePermissions } from '../agent-session/share-permissions';
import { queryClient } from '../client';
import { fetchInitiativeSharePermissions } from '../initiative/share-permissions';
import { getDatabaseSharePermissions } from '../storage/databases';
import { getFormSharePermissions } from '../storage/forms';
import { sharingKeys } from './keys';

const SUPPORTED_SHARE_PERMISSION_ITEM_TYPES: readonly ShareItemType[] = [
  'agent_session',
  'initiative',
  'database',
  'form',
  'chat',
  'document',
  'project',
];

export type SharePermissionsTarget = {
  id: string;
  itemType: ShareItemType;
};

function isSharePermissionsTargetSupported({
  id,
  itemType,
}: SharePermissionsTarget) {
  const hasId = Boolean(id);
  const isSupportedItemType =
    SUPPORTED_SHARE_PERMISSION_ITEM_TYPES.includes(itemType);
  const isTrashProject = itemType === 'project' && id === 'trash';

  return hasId && isSupportedItemType && !isTrashProject;
}

async function fetchSharePermissions({ id, itemType }: SharePermissionsTarget) {
  return match(itemType)
    .with('agent_session', () => fetchAgentSessionSharePermissions(id))
    .with('initiative', () => fetchInitiativeSharePermissions(id))
    .with('database', () => getDatabaseSharePermissions(id))
    .with('form', () => getFormSharePermissions(id))
    .with('chat', () => cognitionApiServiceClient.getChatPermissions({ id }))
    .with('document', () =>
      storageServiceClient.getDocumentPermissions({ document_id: id })
    )
    .with('project', () => storageServiceClient.projects.getPermissions({ id }))
    .otherwise((unsupported) => {
      throw new Error(
        `Sharing permissions are not supported for ${unsupported}`
      );
    });
}

/** The query guards target eligibility; the caller owns the enabled policy. */
export function useSharePermissionsQuery(
  target: Accessor<SharePermissionsTarget>,
  options: { enabled: Accessor<boolean> }
) {
  return useQuery(
    () => {
      const current = target();
      return {
        queryKey: sharingKeys.permissions(current.itemType, current.id)
          .queryKey,
        queryFn: () => throwOnErr(() => fetchSharePermissions(current)),
        enabled:
          options.enabled() && isSharePermissionsTargetSupported(current),
      };
    },
    () => queryClient
  );
}

export type SharePermissions = NonNullable<
  ReturnType<typeof useSharePermissionsQuery>['data']
>;

/** Refresh active permission queries and mark inactive entries stale. */
export function invalidateSharePermissions(target?: SharePermissionsTarget) {
  return queryClient.invalidateQueries({
    queryKey: target
      ? sharingKeys.permissions(target.itemType, target.id).queryKey
      : sharingKeys._def,
  });
}
