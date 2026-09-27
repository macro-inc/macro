import {
  ShareModal as SharedShareModal,
  type TeamShareControls,
} from '@app/features/sharing/components/share-modal';
import {
  ShareOptions as SharedShareOptions,
  SharePermissionOptionsContext,
} from '@app/features/sharing/components/share-options';
import { ShareTrigger as SharedShareTrigger } from '@app/features/sharing/components/share-trigger';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useIsAuthenticated } from '@core/auth';
import {
  type BlockAlias,
  type BlockName,
  createBlockEffect,
  createBlockResource,
  isInBlock,
  useBlockAliasedName,
  useBlockId,
  useBlockName,
  useMaybeBlockAliasedName,
  useMaybeBlockId,
} from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { ENABLE_MARKDOWN_COMMENTS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import clickOutside from '@core/directive/clickOutside';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { blockEditPermissionEnabledSignal } from '@core/signal/load';
import { useIsDocumentOwner } from '@core/signal/permissions';
import { idToEmail } from '@core/user';
import type { ResultError } from '@core/util/result';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useCopyLink } from '@core/util/useCopyLink';
import {
  fetchAgentSessionSharePermissions,
  updateAgentSessionSharePermissions,
} from '@queries/agent-session/share-permissions';
import {
  setCallRecordTeamShareCache,
  sharePermissionFromCallRecord,
  updateCallTeamShare,
  useCallRecordQuery,
} from '@queries/call/call';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { cognitionApiServiceClient } from '@service-cognition/client';
import {
  blockNameToItemType,
  type ItemType,
  storageServiceClient,
} from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { createCallback } from '@solid-primitives/rootless';
import { useNavigate } from '@solidjs/router';
import type { ManagedDialogProps } from '@ui';
import type { Result } from 'neverthrow';
import type { ComponentProps } from 'solid-js';
import {
  type Accessor,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  useContext,
} from 'solid-js';
import { ForwardToChannel } from '../ForwardToChannel';
import { Permissions } from '../SharePermissions';
import { toast } from '../Toast/Toast';
import { openLoginModal } from './LoginButton';
import {
  buildLinkSharePayload,
  buildLinkShareScopePayload,
  buildTeamSharePayload,
  getLinkShareScope,
  getLinkShareScopeCopy,
  getShareItemNoun,
  getShareStatus,
  getTeamShareScope,
  getTeamShareScopeCopy,
  isTeamShareSupportedForItem,
  type LinkSharePayload,
  type LinkShareScope,
  type TeamSharePayload,
  type TeamShareScope,
  teamShareScopeOptionsForItem,
} from './linkShare';

false && clickOutside;

async function fetchSharePermissions(id: string, itemType: ItemType) {
  if (itemType === 'agent_session') {
    return fetchAgentSessionSharePermissions(id);
  }
  if (itemType === 'chat') {
    return cognitionApiServiceClient.getChatPermissions({ id });
  }
  if (itemType === 'document') {
    return storageServiceClient.getDocumentPermissions({ document_id: id });
  }
  if (itemType === 'project') {
    if (id === 'trash') {
      return;
    }
    return storageServiceClient.projects.getPermissions({ id });
  }
}

const SHARE_LINK_SUBTEXT =
  'Sending this link in a Macro message will automatically update permissions to include recipients.';

const agentSessionShareDescription =
  'Only the owner can share access to this session. You can copy a link for people who already have access.';

const permissionsBlockResource = createBlockResource(
  () => {
    const isOwner = useIsDocumentOwner();
    return isOwner();
  },
  async () => {
    const id = useBlockId();
    const blockName = useBlockName();
    const itemType = blockNameToItemType(blockName);
    return fetchSharePermissions(id, itemType);
  },
  { initialValue: undefined }
);

createBlockEffect(() => {
  const [, { refetch }] = permissionsBlockResource;
  setRefetchArray((prev) => [...prev, refetch]);
  onCleanup(() => {
    setRefetchArray((prev) => prev.filter((r) => r !== refetch));
  });
});

const accessLevelText = (accessLevel?: AccessLevel | null) => {
  const blockName = isInBlock() ? useBlockName() : undefined;
  switch (accessLevel) {
    case 'comment':
      if (blockName === 'md' && !ENABLE_MARKDOWN_COMMENTS) {
        return 'View';
      }
      return 'Comment';
    case 'view':
      return 'View';
    case 'edit':
      return 'Edit';
    case 'owner':
      return 'Owner';
    default:
      return 'Remove Access';
  }
};

const [refetchArray, setRefetchArray] = createSignal<(() => void)[]>([]);
export const refetchDocumentShareButtonResource = () => {
  const refetchArray_ = refetchArray();
  if (refetchArray_.length === 0) {
    console.warn('no document share permission refetch functions initialized');
    return;
  }
  refetchArray_.forEach((refetch) => refetch());
};

export { getShareDrawerRecipientInput } from '@app/features/sharing/components/share-modal';

interface ShareModalProps extends ManagedDialogProps {
  userPermissions: Permissions;
  blockAlias: BlockName | BlockAlias;
  itemType: ItemType;
  owner?: string;
  name: string;
  id: string;
  /** Override the entity-only URL with a host view's contextual URL. */
  copyLink?: () => void;
}

export function ShareModal(props: ShareModalProps) {
  const navigate = useNavigate();
  const analytics = useAnalytics();
  const currentTeamQuery = useCurrentTeamQuery();
  const callRecordQuery = useCallRecordQuery(() =>
    props.itemType === 'call' ? props.id : ''
  );
  const isBlockContext = isInBlock() && props.itemType !== 'agent_session';
  const [fallbackPermissionsResource, { refetch: refetchFallback }] =
    createResource(
      () => {
        if (isBlockContext || !props.id) return;
        return { id: props.id, itemType: props.itemType };
      },
      async (source) => {
        if (!source) return;
        const { id, itemType } = source;
        return fetchSharePermissions(id, itemType);
      },
      { initialValue: undefined }
    );
  const permissionsResource = isBlockContext
    ? permissionsBlockResource[0]
    : fallbackPermissionsResource;
  const refetch = isBlockContext
    ? permissionsBlockResource[1].refetch
    : refetchFallback;
  const userId = useUserId();
  const canForward = () =>
    props.itemType !== 'agent_session' ||
    (Boolean(userId()) && props.owner === userId());
  const userPermissions = () =>
    props.itemType === 'agent_session' && !canForward()
      ? Permissions.CAN_VIEW
      : props.userPermissions;
  const editPermissionEnabled = () =>
    props.itemType === 'agent_session' ? true : undefined;

  const copyEntityLink = useCopyLink();

  const copyLink = createCallback(() => {
    if (props.copyLink) return props.copyLink();
    copyEntityLink(
      buildSimpleEntityUrl({ type: props.blockAlias, id: props.id }),
      {
        subtext:
          props.itemType === 'agent_session' ? undefined : SHARE_LINK_SUBTEXT,
      }
    );
  });

  const [channelNamesResource] = createResource(
    () => {
      const result = permissionsResource.latest;
      if (!result || result.isErr()) {
        return;
      }
      const sharePermission = result.value;
      if (!sharePermission?.channelSharePermissions?.length) {
        return;
      }
      const channel_ids = sharePermission.channelSharePermissions.map(
        ({ channel_id }) => channel_id
      );
      return { channel_ids };
    },
    storageServiceClient.getBatchChannelPreviews,
    { initialValue: undefined }
  );

  // Create a map of channel IDs to channel names
  const channelNameMap = createMemo(() => {
    const result = channelNamesResource.latest;
    if (!result || result.isErr()) {
      return new Map();
    }

    const data = result.value;
    const map = new Map();

    data.previews.forEach((preview) => {
      if (preview.type === 'access') {
        map.set(preview.channel_id, {
          name: preview.channel_name,
          type: preview.channel_type,
        });
      }
    });

    return map;
  });

  const recipients = createMemo(() => {
    const result = permissionsResource.latest;
    if (!result || result.isErr()) return;

    const sharePermission = result.value;
    return sharePermission.channelSharePermissions;
  });

  // Function to navigate to a channel
  const navigateToChannel = createCallback((channelId: string) => {
    navigate(`/channel/${channelId}`);
    props.onOpenChange(false); // Close the dialog after navigation
  });

  const removeChannelAccess = createCallback(async (channelId: string) => {
    if (userPermissions() !== Permissions.OWNER) return;
    if (props.itemType === 'agent_session') {
      const result = await updateAgentSessionSharePermissions(props.id, {
        channelSharePermissions: [{ operation: 'remove', channelId }],
      });
      if (result.isOk()) {
        refetch();
        toast.success('Removed channel access');
      } else {
        toast.alert('Failed to remove channel access', {
          subtext: 'Please try again',
        });
      }
    } else if (props.itemType === 'chat') {
      const result = await cognitionApiServiceClient.updateChatPermissions({
        chat_id: props.id,
        sharePermission: {
          channelSharePermissions: [
            {
              operation: 'remove',
              channelId,
            },
          ],
        },
      });
      if (!result.isErr()) {
        refetch();
        toast.success('Removed channel access', {
          subtext: 'Channel no longer has access to this chat',
        });
      } else {
        toast.alert('Failed to remove channel access', {
          subtext: 'Please try again',
        });
        console.error(result);
      }
    } else if (props.itemType === 'document') {
      const result = await storageServiceClient.editDocument({
        documentId: props.id,
        sharePermission: {
          channelSharePermissions: [
            {
              operation: 'remove',
              channelId,
            },
          ],
        },
      });
      if (!result.isErr()) {
        refetch();
        toast.success('Removed channel access', {
          subtext: 'Channel no longer has access to this document',
        });
      } else {
        toast.alert('Failed to remove channel access', {
          subtext: 'Please try again',
        });
        console.error(result);
      }
    } else if (props.itemType === 'project') {
      const result = await storageServiceClient.projects.edit({
        id: props.id,
        sharePermission: {
          channelSharePermissions: [
            {
              operation: 'remove',
              channelId,
            },
          ],
        },
      });
      if (!result.isErr()) {
        refetch();
        toast.success('Removed folder access');
      } else {
        toast.alert('Failed to remove folder access', {
          subtext: 'Please try again',
        });
        console.error(result);
      }
    }
  });

  const setChannelPermissions = createCallback(
    async (
      channelId: string,
      accessLevel: AccessLevel,
      hideSuccessToast?: boolean
    ) => {
      if (userPermissions() !== Permissions.OWNER) return;

      let result:
        | Result<any, ResultError<any>[]>
        | Result<void, ResultError<any>[]>
        | null = null;
      if (props.itemType === 'agent_session') {
        result = await updateAgentSessionSharePermissions(props.id, {
          channelSharePermissions: [
            { operation: 'replace', accessLevel, channelId },
          ],
        });
      } else if (props.itemType === 'chat') {
        result = await cognitionApiServiceClient.updateChatPermissions({
          sharePermission: {
            channelSharePermissions: [
              {
                operation: 'replace',
                accessLevel,
                channelId,
              },
            ],
          },
          chat_id: props.id,
        });
      } else if (props.itemType === 'document') {
        result = await storageServiceClient.editDocument({
          sharePermission: {
            channelSharePermissions: [
              {
                operation: 'replace',
                accessLevel,
                channelId,
              },
            ],
          },
          documentId: props.id,
        });
      } else if (props.itemType === 'project') {
        result = await storageServiceClient.projects.edit({
          sharePermission: {
            channelSharePermissions: [
              {
                operation: 'replace',
                accessLevel,
                channelId,
              },
            ],
          },
          id: props.id,
        });
      } else if (props.itemType === 'email') {
        result = await storageServiceClient.editThread({
          sharePermission: {
            channelSharePermissions: [
              {
                operation: 'replace',
                accessLevel,
                channelId,
              },
            ],
          },
          threadId: props.id,
        });
      }

      if (result && result.isOk()) {
        refetch();
        if (!hideSuccessToast) {
          toast.success('Changed channel access level', {
            subtext: accessLevelText(accessLevel),
          });
        }

        analytics.track('share_entity', {
          entityType: props.itemType,
          entityId: props.id,
          shareMethod: 'channel',
          accessLevel,
        });
        return true;
      } else {
        toast.alert('Failed to change channel access', {
          subtext: 'Please try again',
        });
        console.error(result);
        return false;
      }
    }
  );

  const linkShare = createMemo(() => {
    const currentPermissions = permissionsResource.latest;
    if (!currentPermissions || currentPermissions.isErr()) {
      return;
    }

    return currentPermissions.value.linkShare;
  });

  const linkShareAccessLevel = createMemo(() => {
    const currentPermissions = permissionsResource.latest;
    if (!currentPermissions || currentPermissions.isErr()) {
      return;
    }

    return currentPermissions.value.linkShareAccessLevel;
  });

  const teamShareAccessLevel = createMemo(() => {
    if (props.itemType === 'call') {
      if (!callRecordQuery.isSuccess) return;
      const record = callRecordQuery.data;
      if (!record) return;
      return sharePermissionFromCallRecord(record).teamShareAccessLevel;
    }
    const currentPermissions = permissionsResource.latest;
    if (!currentPermissions || currentPermissions.isErr()) return;

    return currentPermissions.value.teamShareAccessLevel;
  });

  const updateTeamSharePermissions = createCallback(
    async (sharePermission: TeamSharePayload) => {
      if (userPermissions() !== Permissions.OWNER || !canShareWithTeam()) {
        return;
      }
      const itemNoun = getShareItemNoun(props.itemType);
      const shared =
        getTeamShareScope(sharePermission.teamShareAccessLevel) !== 'NONE';

      let result: Result<unknown, ResultError<any>[]>;
      if (props.itemType === 'agent_session') {
        result = await updateAgentSessionSharePermissions(
          props.id,
          sharePermission
        );
      } else if (props.itemType === 'chat') {
        result = await cognitionApiServiceClient.updateChatPermissions({
          sharePermission,
          chat_id: props.id,
        });
      } else if (props.itemType === 'call') {
        result = await updateCallTeamShare(props.id, shared);
      } else if (props.itemType === 'project') {
        result = await storageServiceClient.projects.edit({
          id: props.id,
          sharePermission,
        });
      } else {
        result = await storageServiceClient.editDocument({
          sharePermission,
          documentId: props.id,
        });
      }
      if (result.isErr()) {
        toast.alert('Failed to change team access', {
          subtext: 'Please try again',
        });
        console.error(result);
        return;
      }

      refetch();
      const scope = getTeamShareScope(sharePermission.teamShareAccessLevel);
      if (props.itemType === 'call') {
        setCallRecordTeamShareCache(props.id, shared);
      }
      if (scope === 'NONE') {
        toast.success(`Removed team access for this ${itemNoun}`);
        return;
      }

      toast.success('Updated team access', {
        subtext: `The owner's team can ${getTeamShareScopeCopy(scope).toLowerCase()} this ${itemNoun}`,
      });
      analytics.track('share_entity', {
        entityType: props.itemType,
        entityId: props.id,
        shareMethod: 'team',
        accessLevel: scope,
      });
    }
  );

  const setTeamShareAccessLevel = createCallback((scope: TeamShareScope) => {
    return updateTeamSharePermissions(buildTeamSharePayload(scope));
  });

  const canShareWithTeam = () =>
    isTeamShareSupportedForItem(props.itemType) &&
    (props.itemType !== 'call' ||
      (callRecordQuery.isSuccess && callRecordQuery.data.channelId != null));

  const teamShareControls = (): TeamShareControls | undefined =>
    canShareWithTeam() &&
    userPermissions() === Permissions.OWNER &&
    currentTeamQuery.isSuccess &&
    currentTeamQuery.data
      ? {
          accessLevel: teamShareAccessLevel(),
          setAccessLevel: setTeamShareAccessLevel,
          itemNoun: getShareItemNoun(props.itemType),
          scopeOptions: teamShareScopeOptionsForItem(props.itemType),
        }
      : undefined;

  const updateLinkSharePermissions = createCallback(
    async (sharePermission: LinkSharePayload) => {
      if (userPermissions() !== Permissions.OWNER) return;
      const scope = getLinkShareScope(sharePermission.linkShare);
      let result: Result<any, ResultError<any>[]> | undefined;

      if (props.itemType === 'agent_session') {
        result = await updateAgentSessionSharePermissions(
          props.id,
          sharePermission
        );
      } else if (props.itemType === 'chat') {
        result = await cognitionApiServiceClient.updateChatPermissions({
          sharePermission,
          chat_id: props.id,
        });
      } else if (props.itemType === 'document') {
        result = await storageServiceClient.editDocument({
          sharePermission,
          documentId: props.id,
        });
      } else if (props.itemType === 'project') {
        result = await storageServiceClient.projects.edit({
          sharePermission,
          id: props.id,
        });
      }

      const entityLabel = getShareItemNoun(props.itemType);
      if (!result || result.isErr()) {
        toast.alert(`Failed to change ${entityLabel} access`, {
          subtext: 'Please try again',
        });
        console.error(result);
        return;
      }

      refetch();
      if (scope === 'NONE') {
        toast.success(`Disabled link sharing for this ${entityLabel}`, {
          subtext: getLinkShareScopeCopy('NONE').description,
        });
        return;
      }

      const effectiveAccessLevel =
        sharePermission.linkShareAccessLevel ?? 'view';
      const audience =
        scope === 'PUBLIC'
          ? 'Anyone with the link'
          : "Members of the owner's team with the link";
      toast.success(`Updated ${getLinkShareScopeCopy(scope).title} sharing`, {
        subtext: `${audience} can ${accessLevelText(effectiveAccessLevel).toLowerCase()} this ${entityLabel}`,
      });

      analytics.track('share_entity', {
        entityType: props.itemType,
        entityId: props.id,
        shareMethod: scope === 'PUBLIC' ? 'public_link' : 'team_link',
        accessLevel: effectiveAccessLevel,
        linkShare: scope,
      });
    }
  );

  const setLinkShareScope = createCallback((scope: LinkShareScope) => {
    const sharePermission = buildLinkShareScopePayload(
      getLinkShareScope(linkShare()),
      scope,
      linkShareAccessLevel()
    );
    return updateLinkSharePermissions(sharePermission);
  });

  const setLinkShareAccessLevel = createCallback(
    (accessLevel: AccessLevel | null) => {
      const scope = getLinkShareScope(linkShare());
      if (scope === 'NONE' || accessLevel === null) {
        return;
      }
      return updateLinkSharePermissions(
        buildLinkSharePayload(scope, accessLevel)
      );
    }
  );

  const formattedOwner = createMemo(() => {
    const ownerValue = props.owner;
    if (!ownerValue) {
      return '';
    }
    return ownerValue === userId() ? 'Me' : idToEmail(ownerValue).split('@')[0];
  });

  return (
    <SharePermissionOptionsContext.Provider
      value={legacyShareOptions(editPermissionEnabled)}
    >
      <SharedShareModal
        {...props}
        isSharePermOpen={props.open}
        setIsSharePermOpen={props.onOpenChange}
        userPermissions={userPermissions()}
        icon={
          <EntityIcon
            targetType={props.blockAlias}
            size="sm"
            class="shrink-0"
          />
        }
        canForward={canForward()}
        forwardUnavailableDescription={agentSessionShareDescription}
        recipients={recipients()}
        channelNameMap={channelNameMap()}
        formattedOwner={formattedOwner()}
        linkShare={linkShare()}
        linkShareAccessLevel={linkShareAccessLevel()}
        teamShare={teamShareControls()}
        navigateToChannel={navigateToChannel}
        removeChannelAccess={removeChannelAccess}
        setChannelPermissions={setChannelPermissions}
        setLinkShareScope={setLinkShareScope}
        setLinkShareAccessLevel={setLinkShareAccessLevel}
        copyLink={copyLink}
        forward={(controls) => (
          <ForwardToChannel
            {...controls}
            editPermissionEnabled={editPermissionEnabled()}
            submitPermissionInfo={{
              setChannelPermissions: (id, accessLevel) =>
                setChannelPermissions(id, accessLevel, true),
              userPermissions: userPermissions(),
              channelSharePermissions: recipients(),
            }}
            refetch={refetch}
            name={props.name}
            hideAccessLevelSelector={props.itemType === 'email'}
            initialAccessLevel={props.itemType === 'email' ? 'view' : null}
            blockId={props.id}
            blockName={props.blockAlias}
          />
        )}
      />
    </SharePermissionOptionsContext.Provider>
  );
}

export function ShareTrigger(props: {
  onClick: () => void;
  id?: string;
  blockType?: BlockName | BlockAlias;
  hotkeyScope?: string;
  copyLink?: () => void;
}) {
  const isAuthenticated = useIsAuthenticated();
  const inBlock = isInBlock();
  const contextualBlockType =
    props.blockType === undefined
      ? inBlock
        ? useBlockAliasedName()
        : useMaybeBlockAliasedName()
      : undefined;
  const contextualBlockId =
    props.id === undefined
      ? inBlock
        ? useBlockId()
        : useMaybeBlockId()
      : undefined;
  const analytics = useAnalytics();

  const blockType = (): BlockName | BlockAlias => {
    const type = props.blockType ?? contextualBlockType;
    if (type) return type;
    throw new Error('<ShareTrigger> requires an explicit block type');
  };
  const blockId = (): string => {
    const id = props.id ?? contextualBlockId;
    if (id) return id;
    throw new Error('<ShareTrigger> requires an explicit block id');
  };

  onMount(() => {
    const scopeId =
      props.hotkeyScope ?? (inBlock ? blockHotkeyScopeSignal.get() : undefined);
    if (!scopeId) return;

    const registration = registerHotkey({
      keyDownHandler: () => {
        if (!isAuthenticated()) {
          openLoginModal();
        } else {
          analytics.track('share_menu_open', { blockType: blockType() });
          props.onClick();
        }
        return true;
      },
      hotkeyToken: TOKENS.block.share,
      runWithInputFocused: true,
      scopeId,
      description: 'Share',
      hotkey: 'cmd+s',
    });
    onCleanup(() => registration.dispose());
  });

  const copyEntityLink = useCopyLink();

  const copyLink = createCallback(() => {
    if (props.copyLink) return props.copyLink();
    copyEntityLink(buildSimpleEntityUrl({ id: blockId(), type: blockType() }), {
      subtext: blockType() === 'agent' ? undefined : SHARE_LINK_SUBTEXT,
    });
    analytics.track('copy_share_link', { blockType: blockType() });
  });

  const shareStatus = createMemo(() => {
    if (blockType() === 'agent' || !inBlock) return;
    const result = permissionsBlockResource[0].latest;
    if (!result || result.isErr()) return;

    const sharePermission = result.value;
    return getShareStatus(
      sharePermission.linkShare,
      (sharePermission.channelSharePermissions?.length ?? 0) > 0,
      sharePermission.teamShareAccessLevel
    );
  });

  return (
    <SharedShareTrigger
      tooltip={
        shareStatus()?.tooltip ??
        (blockType() === 'agent'
          ? 'Share agent session'
          : inBlock
            ? 'This item has been shared with you.'
            : `Share ${blockType()}`)
      }
      copyLink={copyLink}
      open={() => {
        if (!isAuthenticated()) openLoginModal();
        else {
          analytics.track('share_menu_open', { blockType: blockType() });
          props.onClick();
        }
      }}
    />
  );
}

function legacyShareOptions(
  editPermissionEnabled?: Accessor<boolean | undefined>
) {
  const inBlock = isInBlock();
  const blockName = inBlock ? useBlockName() : undefined;
  return {
    get editEnabled() {
      return (
        editPermissionEnabled?.() ??
        (inBlock ? !!blockEditPermissionEnabledSignal() : true)
      );
    },
    commentEnabled: blockName !== 'md' || ENABLE_MARKDOWN_COMMENTS,
  };
}

export function ShareOptions(props: ComponentProps<typeof SharedShareOptions>) {
  const inherited = useContext(SharePermissionOptionsContext);
  return (
    <SharePermissionOptionsContext.Provider
      value={inherited ?? legacyShareOptions()}
    >
      <SharedShareOptions {...props} />
    </SharePermissionOptionsContext.Provider>
  );
}
