import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import {
  AccessRequestError,
  DirectAccessView,
  PermissionRequestsView,
  RequestAccessView,
  useShareRequests,
} from '@app/features/access-requests/access-requests';
import type { SharingSource } from '@app/features/access-requests/context/contracts';
import { shareEntity } from '@app/features/access-requests/core/types';
import {
  ShareRequestIcon,
  useShareRequestTrigger,
} from '@app/features/access-requests/share-request-trigger';
import { DirectAccessInvite } from '@app/features/access-requests/views/DirectAccessInvite';
import type { MeetingAccessState } from '@app/features/calendar-notes/core/types';
import { DocumentMeetingNotes } from '@app/features/calendar-notes/document-meeting-notes';
import {
  updatePipelineSharePermissions,
  updatePipelineTeamShare,
} from '@app/features/crm/sharing-adapter';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useChannelParticipants } from '@channel/use-channel-participants';
import { HeaderActionButton } from '@components/app/HeaderActionButton';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
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
import {
  type UnderlineTabItem,
  UnderlineTabs,
} from '@core/component/UnderlineTabs';
import { UserIcon } from '@core/component/UserIcon';
import { resolveBlockAlias } from '@core/constant/allBlocks';
import {
  ENABLE_MARKDOWN_COMMENTS,
  ENABLE_MARKDOWN_LIVE_COLLABORATION,
  enableCalendarMeetingNotes,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import clickOutside from '@core/directive/clickOutside';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { blockEditPermissionEnabledSignal } from '@core/signal/load';
import { useIsDocumentOwner } from '@core/signal/permissions';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ResultError } from '@core/util/result';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useCopyLink } from '@core/util/useCopyLink';
import { OwnerLabel } from '@entity/owner/owner-display';
import IconShared from '@icon/share.svg';
import ChevronDownIcon from '@icon/system/regular/caret-down.svg';
import IconComment from '@icon/system/regular/chat-teardrop.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import IconEye from '@icon/system/regular/eye.svg';
import IconLink from '@icon/system/regular/link.svg';
import IconEdit from '@icon/system/regular/pencil.svg';
import UserCircle from '@icon/system/regular/user-circle.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import IconX from '@icon/system/regular/x.svg';
import { Dialog } from '@kobalte/core/dialog';
import { updateAgentSessionSharePermissions } from '@queries/agent-session/share-permissions';
import {
  setCallRecordTeamShareCache,
  sharePermissionFromCallRecord,
  updateCallTeamShare,
  useCallRecordQuery,
} from '@queries/call/call';
import { updateExternalChatPermissions } from '@queries/external-chats/share-permissions';
import { updateInitiativeSharePermissions } from '@queries/initiative/share-permissions';
import {
  fetchSharePermissions,
  invalidateSharePermissions,
  prefetchShareChannelNames,
  prefetchSharePermissions,
  shareChannelNamesQueryOptions,
  sharedChannelIds,
  sharePermissionsQueryOptions,
} from '@queries/share/share-permissions';
import { updateDatabaseSharePermissions } from '@queries/storage/databases';
import {
  updateEntitySharePolicy,
  usesGraphqlSharePolicy,
} from '@queries/storage/entity-mutations';
import { updateFormSharePermissions } from '@queries/storage/forms';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { cognitionApiServiceClient } from '@service-cognition/client';
import {
  blockNameToItemType,
  storageServiceClient,
} from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { LinkShare } from '@service-storage/generated/schemas/linkShare';
import type { SharePermissionV2ChannelSharePermissions } from '@service-storage/generated/schemas/sharePermissionV2ChannelSharePermissions';
import { createCallback } from '@solid-primitives/rootless';
import { useNavigate } from '@solidjs/router';
import { useQuery, useQueryClient } from '@tanstack/solid-query';
import {
  Button,
  ButtonGroup,
  CopyButton,
  cn,
  Dropdown,
  type ManagedDialogProps,
  Panel,
  Tabs,
  Tooltip,
} from '@ui';
import type { Result } from 'neverthrow';
import {
  type Component,
  type ComponentProps,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { CustomScrollbar } from '../CustomScrollbar';
import { ForwardToChannel } from '../ForwardToChannel';
import { Permissions } from '../SharePermissions';
import { toast } from '../Toast/Toast';
import { ScrollIndicators } from '../VerticalScrollIndicators';
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
  LINK_SHARE_SCOPE_OPTIONS,
  type LinkSharePayload,
  type LinkShareScope,
  type ShareItemType,
  type TeamSharePayload,
  type TeamShareScope,
  teamShareScopeOptionsForItem,
} from './linkShare';

false && clickOutside;

const isLinkSharingDisabledForItem = (itemType: ShareItemType): boolean =>
  itemType === 'email' ||
  itemType === 'project' ||
  itemType === 'database' ||
  // A form's public link is its audience, set on the form, not a share permission.
  itemType === 'form' ||
  itemType === 'crm_pipeline';

/** Blocks, plus native entities that are shared without one. */
type ShareBlockType = BlockName | BlockAlias | 'initiative' | 'external_chat';

function shareUrl(type: ShareBlockType, id: string): string {
  if (type === 'external_chat')
    return buildSimpleEntityUrl({ type: 'external/whatsapp', id });
  return buildSimpleEntityUrl({ type, id });
}

/**
 * The levels a recipient can hold on an item: forms have no comments, and a
 * external chat is read-only in Macro (sending follows provider membership).
 */
export function shareLevelsFor(
  itemType: ShareItemType,
  blockAlias?: ShareBlockType
): readonly AccessLevel[] | undefined {
  if (itemType === 'form') return ['view', 'edit'];
  if (
    itemType === 'document' &&
    blockAlias &&
    blockAlias !== 'external_chat' &&
    resolveBlockAlias(blockAlias) === 'md'
  ) {
    const levels: AccessLevel[] = ['view'];
    if (ENABLE_MARKDOWN_COMMENTS) levels.push('comment');
    if (ENABLE_MARKDOWN_LIVE_COLLABORATION) levels.push('edit');
    return levels;
  }
  if (itemType === 'external_chat') return ['view'];
  return undefined;
}

const SHARE_LINK_SUBTEXT =
  'Sending this link in a Macro message will automatically update permissions to include recipients.';

// Only these items' owners (a pipeline's editors) can grant access, so only
// they may forward. Their links don't grant access to recipients either, so
// copying skips SHARE_LINK_SUBTEXT.
const RESTRICTED_SHARE_DESCRIPTIONS: Partial<Record<ShareItemType, string>> = {
  external_chat:
    'Only the owner can share access to this chat. Sending always requires your own connected account.',
  crm_pipeline:
    'Only editors can share this pipeline. You can copy a link for people who already have access.',
  agent_session:
    'Only the owner can share access to this session. You can copy a link for people who already have access.',
  initiative:
    'Only the owner can share access to this project. You can copy a link for people who already have access.',
};

type ChannelPermissionSetter = (
  channelId: string,
  accessLevel: AccessLevel,
  hideSuccessToast?: boolean
) => Promise<boolean | undefined>;

/**
 * Where a forwarded message points. Nothing grants a native project or a
 * pipeline on send, so recipients could not open it yet: both grant first.
 */
function forwardTarget(
  blockAlias: ShareBlockType,
  id: string,
  setChannelPermissions: ChannelPermissionSetter
): Pick<
  ComponentProps<typeof ForwardToChannel>,
  'blockId' | 'blockName' | 'entity' | 'prepareChannel'
> {
  const prepareChannel = async (
    channelId: string,
    accessLevel: AccessLevel | null
  ) => {
    const granted =
      accessLevel &&
      (await setChannelPermissions(channelId, accessLevel, true));
    if (!granted)
      throw new Error(
        `Could not share this ${blockAlias === 'pipeline' ? 'pipeline' : 'project'}`
      );
  };
  if (blockAlias === 'external_chat')
    throw new Error('External chats use direct people sharing');
  if (blockAlias === 'pipeline')
    return { blockId: id, blockName: blockAlias, prepareChannel };
  if (blockAlias !== 'initiative')
    return { blockId: id, blockName: blockAlias };
  return {
    entity: { entity_type: 'initiative', entity_id: id },
    prepareChannel,
  };
}

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
  invalidateSharePermissions();
  const refetchArray_ = refetchArray();
  if (refetchArray_.length === 0) {
    console.warn('no document share permission refetch functions initialized');
    return;
  }
  refetchArray_.forEach((refetch) => refetch());
};

export function getShareDrawerRecipientInput(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-share-drawer-recipient] input'
  );
}

interface ShareModalProps extends ManagedDialogProps {
  userPermissions: Permissions;
  blockAlias: ShareBlockType;
  itemType: ShareItemType;
  owner?: string;
  name: string;
  id: string;
  /** Override the entity-only URL with a host view's contextual URL. */
  copyLink?: () => void;
  /** Rows for access the host grants outside channels, e.g. collaborators. */
  people?: Component;
  /** Entity-owned controls in the standard link-sharing area. */
  linkSharing?: Component;
  /** Whether `people` lists anyone, for the link-sharing status. */
  hasDirectShares?: boolean;
  directPeopleIds?: readonly string[];
}

function DmRecipientIcon(props: { channelId: string }) {
  const currentUserId = useUserId();
  const { ids } = useChannelParticipants(() => props.channelId);
  const dmPartnerId = createMemo(() =>
    ids().find((id) => id !== currentUserId())
  );
  return (
    <Show
      when={dmPartnerId()}
      fallback={<UserCircle class="shrink-0 size-4" />}
    >
      {(id) => (
        <UserIcon id={id()} size="sm" isDeleted={false} showTooltip={false} />
      )}
    </Show>
  );
}

function shortName(user: { name: string; email: string }): string {
  const display = user.name || user.email;
  if (display.includes('@')) return display.split('@')[0];
  return display.split(' ')[0];
}

function GroupChannelLabel(props: { channelId: string; fallbackName: string }) {
  const currentUserId = useUserId();
  const { users } = useChannelParticipants(() => props.channelId);
  const others = createMemo(() =>
    users().filter((u) => u.id !== currentUserId())
  );

  const label = createMemo(() => {
    const rest = others();
    if (rest.length === 0) return props.fallbackName;

    const MAX_CHARS = 20;
    const names: string[] = [];
    let charsUsed = 0;

    for (const user of rest) {
      const name = shortName(user);
      const separator = names.length > 0 ? ', ' : '';
      if (charsUsed + separator.length + name.length > MAX_CHARS) break;
      names.push(name);
      charsUsed += separator.length + name.length;
    }

    const remaining = rest.length - names.length;
    const base = names.join(', ');
    if (remaining === 0) return base;
    return `${base} +${remaining} ${remaining === 1 ? 'other' : 'others'}`;
  });

  const tooltipContent = createMemo(() =>
    others()
      .map((u) => u.name || u.email)
      .join('\n')
  );

  return (
    <Show when={others().length > 0} fallback={props.fallbackName}>
      <Tooltip placement="bottom" label={tooltipContent()}>
        <span>{label()}</span>
      </Tooltip>
    </Show>
  );
}

interface LinkSharingControlsProps {
  editPermissionEnabled?: boolean;
  allowedAccessLevels?: readonly AccessLevel[];
  linkShare: LinkShare | null | undefined;
  linkShareAccessLevel: AccessLevel | null | undefined;
  hasExplicitShares: boolean;
  meetingAccess?: MeetingAccessState | 'unknown';
  setLinkShareScope: (scope: LinkShareScope) => void;
  setLinkShareAccessLevel: (accessLevel: AccessLevel | null) => void;
  copyLink: () => void;
  teamShare?: TeamShareControls;
  /** The current link setting is still loading; don't show it as off. */
  loading?: boolean;
}

/** Owner-only explicit team sharing, present only for entity types that support it. */
interface TeamShareControls {
  accessLevel: AccessLevel | null | undefined;
  /** An independent view grant that is managed under Meeting links. */
  meetingViewAccess?: boolean;
  meetingAccess?: MeetingAccessState | 'unknown';
  setAccessLevel: (scope: TeamShareScope) => void;
  /** Noun for the copy, e.g. "document" or "chat". */
  itemNoun: string;
  scopeOptions: ReadonlyArray<{ value: TeamShareScope; label: string }>;
}

function teamShareOnOwnCard(
  itemType: ShareItemType,
  teamShare: TeamShareControls | undefined
): TeamShareControls | undefined {
  return teamShare && isLinkSharingDisabledForItem(itemType)
    ? teamShare
    : undefined;
}

function TeamAccessSection(props: { teamShare: TeamShareControls }) {
  const teamShareScope = () => getTeamShareScope(props.teamShare.accessLevel);
  const label = () => {
    const scope = teamShareScope();
    if (scope !== 'NONE') return getTeamShareScopeCopy(scope);
    if (props.teamShare.meetingViewAccess) return 'View via meeting';
    if (props.teamShare.meetingAccess === 'loading') return 'Checking…';
    if (props.teamShare.meetingAccess === 'error')
      return 'Check meeting access';
    if (props.teamShare.meetingAccess === 'unknown') return 'Direct: None';
    return getTeamShareScopeCopy(scope);
  };

  return (
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-col gap-1">
        <span class="font-medium">Team access</span>
        <p class="text-sm text-ink-muted">
          <Show
            when={props.teamShare.meetingViewAccess}
            fallback={
              <>
                Share this {props.teamShare.itemNoun} directly with the owner's
                team.
              </>
            }
          >
            Your team can view through meeting links.
          </Show>
        </p>
      </div>
      <Dropdown>
        <Dropdown.Trigger
          variant="secondary"
          aria-label="Team access"
          class="min-w-16.75 py-1 pl-2 pr-1 flex items-center gap-1"
        >
          {label()}
          <ChevronDownIcon class="size-4 text-ink-extra-muted" />
        </Dropdown.Trigger>
        <Dropdown.Content portalScope="local">
          <Dropdown.RadioGroup
            aria-label="Team access level"
            value={teamShareScope()}
            onChange={(value) =>
              props.teamShare.setAccessLevel(value as TeamShareScope)
            }
          >
            <For each={props.teamShare.scopeOptions}>
              {(option) => (
                <Dropdown.RadioItem value={option.value}>
                  <span class="flex-1 truncate">
                    {option.value === 'NONE' &&
                    props.teamShare.meetingViewAccess
                      ? 'Use meeting access'
                      : option.label}
                  </span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5 text-accent" />
                  </Dropdown.ItemIndicator>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Content>
      </Dropdown>
    </div>
  );
}

function LinkSharingControls(props: LinkSharingControlsProps) {
  const scope = () => getLinkShareScope(props.linkShare);
  const scopeCopy = () => getLinkShareScopeCopy(scope());
  const shareStatus = () => {
    const status = getShareStatus(
      props.linkShare,
      props.hasExplicitShares || props.meetingAccess === 'shared',
      props.teamShare?.accessLevel ??
        (props.teamShare?.meetingViewAccess ? 'view' : undefined)
    );
    if (
      status.label === 'Team' &&
      props.teamShare?.meetingViewAccess &&
      !props.teamShare.accessLevel &&
      !props.linkShare
    ) {
      return {
        ...status,
        tooltip: 'Your team can view through meeting links.',
      };
    }
    if (status.label === 'Shared' && props.meetingAccess === 'shared') {
      return {
        ...status,
        tooltip: props.hasExplicitShares
          ? 'Shared with specific people or channels and through meeting links.'
          : 'Shared through meeting links with meeting viewers and any teams selected there.',
      };
    }
    if (status.label !== 'Just me') return status;
    if (props.meetingAccess === 'unknown') {
      return {
        label: 'Restricted',
        tooltip: 'Only people with access can open this link.',
      };
    }
    if (props.meetingAccess === 'loading') {
      return {
        label: 'Checking access…',
        tooltip: 'Meeting links may grant additional access.',
      };
    }
    if (props.meetingAccess === 'error') {
      return {
        label: 'Check meeting access',
        tooltip:
          'Meeting links may grant additional access. See Meeting links.',
      };
    }
    return status;
  };

  return (
    <Show when={!props.loading} fallback={<LinkSharingSkeleton />}>
      <div class="flex flex-col gap-3 p-4 text-sm text-ink">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <span class="font-medium">{scopeCopy().title}</span>
            <Tooltip label={shareStatus().tooltip}>
              <div
                class={cn(
                  'flex items-center justify-center rounded-xl border px-2 py-0.5',
                  shareStatus().label === 'Just me'
                    ? 'border-edge-muted bg-edge-muted text-ink-extra-muted'
                    : 'border-accent/30 bg-accent/10 text-accent'
                )}
              >
                <span class="text-xs font-medium whitespace-nowrap">
                  {shareStatus().label}
                </span>
              </div>
            </Tooltip>
          </div>
          <Tabs
            touch="segmented"
            aria-label="Link sharing scope"
            size="sm"
            value={scope()}
            options={LINK_SHARE_SCOPE_OPTIONS}
            onChange={props.setLinkShareScope}
          />
        </div>
        <p class="text-sm text-ink-muted">{scopeCopy().description}</p>
        <Show when={scope() !== 'NONE'}>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2 text-ink-muted">
              <span>Access level</span>
              <ShareOptions
                editPermissionEnabled={props.editPermissionEnabled}
                allowedAccessLevels={props.allowedAccessLevels}
                permissions={props.linkShareAccessLevel ?? 'view'}
                hideNoAccess={true}
                setPermissions={props.setLinkShareAccessLevel}
              />
            </div>
            <Button variant="secondary" onClick={props.copyLink}>
              <CopyIcon class="size-4" />
              <span>Copy Link</span>
            </Button>
          </div>
        </Show>
        <Show when={props.teamShare}>
          {(teamShare) => (
            <div class="border-t border-edge-muted pt-3">
              <TeamAccessSection teamShare={teamShare()} />
            </div>
          )}
        </Show>
      </div>
    </Show>
  );
}

function LinkSharingSkeleton() {
  return (
    <ListSkeleton.Root label="Loading link sharing" class="p-4">
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <ListSkeleton.Bar class="h-3 w-32" />
          <ListSkeleton.Bar class="h-7 w-48" />
        </div>
        <ListSkeleton.Bar class="h-3 w-64" />
      </div>
    </ListSkeleton.Root>
  );
}

/**
 * Mounts its children once the dialog around it has painted. The share form's
 * editor and recipient list cost a frame or more to build, and building them
 * inside the click kept the whole dialog from appearing until they were done.
 */
function AfterFirstPaint(props: ParentProps<{ fallback: JSX.Element }>) {
  const [ready, setReady] = createSignal(false);
  onMount(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // The frame callback runs before that frame paints; the task after it
    // runs once it has.
    const frame = requestAnimationFrame(() => {
      timeout = setTimeout(() => setReady(true));
    });
    onCleanup(() => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
    });
  });
  return (
    <Show when={ready()} fallback={props.fallback}>
      {props.children}
    </Show>
  );
}

function ShareFormSkeleton() {
  return (
    <ListSkeleton.Root label="Loading share form" class="p-4">
      <div class="flex flex-col gap-3">
        <ListSkeleton.Bar class="h-8 w-full" />
        <ListSkeleton.Bar class="h-3 w-40" />
        <ListSkeleton.Bar class="h-16 w-full rounded-xl" />
      </div>
    </ListSkeleton.Root>
  );
}

/** Placeholder rows for the channels an item is shared with. */
function RecipientsSkeleton() {
  return (
    <ListSkeleton.Root label="Loading people with access">
      <div class="grid gap-3">
        <For each={[0, 1]}>
          {() => (
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <ListSkeleton.Bar class="size-4 shrink-0" />
                <ListSkeleton.Bar class="h-3 w-32" />
              </div>
              <ListSkeleton.Bar class="h-3 w-16" />
            </div>
          )}
        </For>
      </div>
    </ListSkeleton.Root>
  );
}

interface MobileShareDrawerProps {
  meetingNotesEnabled: boolean;
  meetingAccess?: MeetingAccessState | 'unknown';
  onMeetingAccessState: (state: MeetingAccessState, teamIds: string[]) => void;
  requests: SharingSource;
  requestLevels: readonly AccessLevel[];
  editPermissionEnabled?: boolean;
  canForward: boolean;
  /** The roster lists only the owner, so it is titled for them alone. */
  ownerOnlyRoster: boolean;
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
  blockAlias: ShareBlockType;
  name: string;
  id: string;
  itemType: ShareItemType;
  owner?: string;
  people?: Component;
  linkSharing?: Component;
  hasDirectShares?: boolean;
  directPeopleIds?: readonly string[];
  userPermissions: Permissions;
  recipients: SharePermissionV2ChannelSharePermissions | undefined;
  channelNameMap: Map<string, { name: string; type: string }>;
  linkShare: LinkShare | null | undefined;
  linkShareAccessLevel: AccessLevel | null | undefined;
  teamShare?: TeamShareControls;
  permissionsLoading: boolean;
  refetch: () => void;
  navigateToChannel: (channelId: string) => void;
  removeChannelAccess: (channelId: string) => void;
  setChannelPermissions: ChannelPermissionSetter;
  setLinkShareScope: (scope: LinkShareScope) => void;
  setLinkShareAccessLevel: (accessLevel: AccessLevel | null) => void;
  copyLink: () => void;
}

function MobileShareDrawer(props: MobileShareDrawerProps) {
  const userId = useUserId();
  const [activeTab, setActiveTab] = createSignal<string>();

  const wrappedSetOpen = (open: boolean) => {
    props.setIsOpen(open);
    if (!open) {
      setActiveTab(undefined);
    }
  };

  const mobileTabs = createMemo((): UnderlineTabItem[] => {
    const tabs: UnderlineTabItem[] = [{ value: 'share', label: 'Share' }];
    if ((props.recipients?.length ?? 0) > 0 || props.owner)
      tabs.push({
        value: 'people',
        label: props.ownerOnlyRoster ? 'Owner' : 'People',
      });
    if (
      props.linkSharing ||
      (props.userPermissions === Permissions.OWNER &&
        !isLinkSharingDisabledForItem(props.itemType))
    )
      tabs.push({ value: 'link', label: 'Link' });
    if (teamShareOnOwnCard(props.itemType, props.teamShare))
      tabs.push({ value: 'team', label: 'Team' });
    return tabs;
  });

  const effectiveActiveTab = createMemo(() => {
    const tab =
      activeTab() ??
      (props.requests.state()?.canReview &&
      (props.requests.state()?.pendingCount ?? 0) > 0
        ? 'people'
        : 'share');
    return mobileTabs().find((t) => t.value === tab) ? tab : 'share';
  });

  const [forwardRef, setForwardRef] = createSignal<{
    handleSubmit: () => void;
    canSubmit: () => boolean;
  }>();

  return (
    <MobileDrawer
      open={props.isOpen}
      onOpenChange={wrappedSetOpen}
      closeOnOutsidePointerStrategy="pointerdown"
      initialFocusEl={getShareDrawerRecipientInput() ?? undefined}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          aria-label="Share"
          class="h-[80vh] overflow-y-auto"
        >
          <div class="flex justify-center pt-3 pb-1 shrink-0">
            <div class="w-10 h-1 rounded-full bg-edge-muted" />
          </div>
          <div class="shrink-0 flex items-center justify-between px-3 text-sm font-medium text-ink min-h-11">
            <div class="flex items-center gap-1.5 flex-1 min-w-0">
              <EntityIcon
                targetType={props.blockAlias}
                size="sm"
                class="shrink-0"
              />
              <span class="truncate">{props.name}</span>
            </div>
            <Show when={effectiveActiveTab() === 'share' && props.canForward}>
              <Button
                variant="primary"
                size="sm"
                class="shrink-0 ml-2"
                disabled={!forwardRef()?.canSubmit()}
                onClick={() => forwardRef()?.handleSubmit()}
              >
                Share
              </Button>
            </Show>
          </div>
          <div class="shrink-0 h-9 border-b border-edge-muted px-3 mb-2">
            <UnderlineTabs
              list={mobileTabs()}
              value={effectiveActiveTab()}
              onChange={setActiveTab}
              indicatorPosition="bottom"
            />
          </div>
          {/* Share tab: always mounted to preserve input state */}
          <div
            style={{
              display: effectiveActiveTab() === 'share' ? undefined : 'none',
            }}
          >
            <Show
              when={
                props.itemType === 'external_chat' &&
                props.userPermissions === Permissions.OWNER
              }
              fallback={
                <Show when={!props.canForward}>
                  <p class="px-4 py-3 text-sm text-ink-muted">
                    {RESTRICTED_SHARE_DESCRIPTIONS[props.itemType]}
                  </p>
                </Show>
              }
            >
              <DirectAccessInvite
                source={props.requests}
                description="Invite someone to read this conversation. Sending requires their own connected account."
              />
            </Show>
            <Show when={props.canForward}>
              <AfterFirstPaint fallback={<ShareFormSkeleton />}>
                <ForwardToChannel
                  {...forwardTarget(
                    props.blockAlias,
                    props.id,
                    props.setChannelPermissions
                  )}
                  editPermissionEnabled={props.editPermissionEnabled}
                  ref={(handle) => setForwardRef(handle)}
                  submitPermissionInfo={{
                    setChannelPermissions: (id, accessLevel) =>
                      props.setChannelPermissions(id, accessLevel, true),
                    userPermissions: props.userPermissions,
                    channelSharePermissions: props.recipients,
                  }}
                  onSubmit={() => props.setIsOpen(false)}
                  refetch={props.refetch}
                  name={props.name}
                  hideAccessLevelSelector={props.itemType === 'email'}
                  initialAccessLevel={
                    props.itemType === 'email' ? 'view' : null
                  }
                  allowedAccessLevels={shareLevelsFor(
                    props.itemType,
                    props.blockAlias
                  )}
                />
              </AfterFirstPaint>
            </Show>
            <Show when={!props.canForward}>
              <div class="px-4 py-3">
                <Button variant="secondary" onClick={props.copyLink}>
                  <CopyIcon class="size-4" />
                  <span>Copy Link</span>
                </Button>
              </div>
            </Show>
          </div>
          <Show when={effectiveActiveTab() === 'people'}>
            <AccessRequestError source={props.requests} />
            <PermissionRequestsView source={props.requests} />
            <div class="grid gap-3 text-ink text-sm select-none py-3 px-4">
              <Show when={props.owner}>
                <div class="flex justify-between">
                  <div class="flex items-center gap-2 overflow-hidden font-medium">
                    <OwnerLabel ownerId={props.owner} viewerLabel="Me" />
                  </div>
                  <div class="flex items-center">
                    <div class="font-medium text-ink-muted text-xs">Owner</div>
                  </div>
                </div>
              </Show>
              <RequestAccessView
                source={props.requests}
                allowedLevels={props.requestLevels}
              />
              <DirectAccessView
                source={props.requests}
                exclude={props.directPeopleIds}
              />
              <Dynamic component={props.people} />
              <For each={props.recipients || []}>
                {(recipient) => (
                  <div class="flex justify-between">
                    <div
                      class="flex items-center gap-2 overflow-hidden"
                      onClick={() =>
                        props.navigateToChannel(recipient.channel_id)
                      }
                    >
                      <Switch fallback={<UsersIcon class="shrink-0 size-4" />}>
                        <Match
                          when={
                            props.channelNameMap.get(recipient.channel_id)
                              ?.type === 'direct_message'
                          }
                        >
                          <DmRecipientIcon channelId={recipient.channel_id} />
                        </Match>
                        <Match
                          when={props.channelNameMap.get(recipient.channel_id)}
                        >
                          <UsersIcon class="shrink-0 size-4" />
                        </Match>
                      </Switch>
                      <div class="font-medium truncate">
                        <Show
                          when={
                            props.channelNameMap.get(recipient.channel_id)
                              ?.type !== 'direct_message'
                          }
                          fallback={
                            props.channelNameMap.get(recipient.channel_id)
                              ?.name || 'Conversation'
                          }
                        >
                          <GroupChannelLabel
                            channelId={recipient.channel_id}
                            fallbackName={
                              props.channelNameMap.get(recipient.channel_id)
                                ?.name || 'Conversation'
                            }
                          />
                        </Show>
                      </div>
                      <Show when={props.itemType === 'form'}>
                        <span class="shrink-0 text-xs text-ink-muted">
                          Can respond (channel)
                        </span>
                      </Show>
                    </div>
                    <div class="flex items-center">
                      <ShareOptions
                        editPermissionEnabled={props.editPermissionEnabled}
                        allowedAccessLevels={shareLevelsFor(
                          props.itemType,
                          props.blockAlias
                        )}
                        disabled={props.userPermissions !== Permissions.OWNER}
                        permissions={recipient.access_level}
                        setPermissions={(accessLevel) => {
                          if (accessLevel === null) {
                            props.removeChannelAccess(recipient.channel_id);
                          } else if (accessLevel !== recipient.access_level) {
                            fireAndForget(
                              props.setChannelPermissions(
                                recipient.channel_id,
                                accessLevel
                              ),
                              'share-modal'
                            );
                          }
                        }}
                      />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={effectiveActiveTab() === 'link'}>
            <Show
              when={props.linkSharing}
              fallback={
                <LinkSharingControls
                  allowedAccessLevels={shareLevelsFor(
                    props.itemType,
                    props.blockAlias
                  )}
                  loading={props.permissionsLoading}
                  meetingAccess={props.meetingAccess}
                  editPermissionEnabled={props.editPermissionEnabled}
                  linkShare={props.linkShare}
                  linkShareAccessLevel={props.linkShareAccessLevel}
                  hasExplicitShares={
                    (props.recipients?.length ?? 0) > 0 ||
                    !!props.hasDirectShares
                  }
                  setLinkShareScope={props.setLinkShareScope}
                  setLinkShareAccessLevel={props.setLinkShareAccessLevel}
                  copyLink={props.copyLink}
                  teamShare={props.teamShare}
                />
              }
            >
              <div class="p-4">
                <Dynamic component={props.linkSharing} />
              </div>
            </Show>
            <Show
              when={
                props.meetingNotesEnabled &&
                props.blockAlias === 'md' &&
                props.itemType === 'document' &&
                !!userId() &&
                props.owner === userId()
              }
            >
              <DocumentMeetingNotes
                documentId={props.id}
                onAccessState={props.onMeetingAccessState}
              />
            </Show>
          </Show>
          <Show
            when={
              effectiveActiveTab() === 'team'
                ? teamShareOnOwnCard(props.itemType, props.teamShare)
                : undefined
            }
          >
            {(teamShare) => (
              <div class="p-4 text-sm text-ink">
                <TeamAccessSection teamShare={teamShare()} />
              </div>
            )}
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

export function ShareModal(props: ShareModalProps) {
  const meetingNotesFlag = useFeatureFlag(enableCalendarMeetingNotes);
  const requests = useShareRequests(
    () => shareEntity(props.itemType, props.id),
    () => props.open
  );
  const requestLevels = () =>
    (requests.state()?.supportedLevels ?? []).filter(
      (level) =>
        !(props.blockAlias === 'pdf' && level === 'edit') &&
        !(
          ['md', 'task', 'snippet', 'skill'].includes(props.blockAlias) &&
          ((level === 'comment' && !ENABLE_MARKDOWN_COMMENTS) ||
            (level === 'edit' && !ENABLE_MARKDOWN_LIVE_COLLABORATION))
        )
    );
  const navigate = useNavigate();
  const analytics = useAnalytics();
  const currentTeamQuery = useCurrentTeamQuery();
  const callRecordQuery = useCallRecordQuery(() =>
    props.itemType === 'call' ? props.id : ''
  );
  // A calendar can open Share for a linked note. Only reuse the enclosing
  // block's permissions when the dialog is sharing that same entity.
  const enclosingBlockId = useMaybeBlockId();
  const isBlockContext = () =>
    !!enclosingBlockId &&
    enclosingBlockId === props.id &&
    props.itemType !== 'agent_session' &&
    props.itemType !== 'initiative' &&
    props.itemType !== 'crm_pipeline' &&
    props.itemType !== 'external_chat';
  // Outside a block the dialog reads a cached query, which the Share trigger
  // warms on hover, so it opens with the roster already in hand.
  const queryClient = useQueryClient();
  const fallbackPermissionsQuery = useQuery(() => ({
    ...sharePermissionsQueryOptions(props.id, props.itemType),
    enabled: !isBlockContext() && !!props.id,
  }));
  const sharePermission = () => {
    if (isBlockContext()) {
      const result = permissionsBlockResource[0].latest;
      return result && !result.isErr() ? result.value : undefined;
    }
    return fallbackPermissionsQuery.isPending
      ? undefined
      : (fallbackPermissionsQuery.data ?? undefined);
  };
  const permissionsLoading = () =>
    isBlockContext()
      ? permissionsBlockResource[0].loading &&
        !permissionsBlockResource[0].latest
      : fallbackPermissionsQuery.isLoading;
  const refetch = async () => {
    if (isBlockContext()) {
      await permissionsBlockResource[1].refetch();
      return;
    }
    // A change made while the first read is in flight must not settle on
    // that read's stale result.
    if (fallbackPermissionsQuery.isFetching) {
      await queryClient.cancelQueries({
        queryKey: sharePermissionsQueryOptions(props.id, props.itemType)
          .queryKey,
      });
    }
    await fallbackPermissionsQuery.refetch();
  };
  const userId = useUserId();
  const [meetingAccessSnapshot, setMeetingAccessSnapshot] = createSignal<{
    documentId: string;
    userId: string | undefined;
    state: MeetingAccessState;
    teamIds: string[];
  }>();
  const setMeetingAccess = (state: MeetingAccessState, teamIds: string[]) =>
    setMeetingAccessSnapshot({
      documentId: props.id,
      userId: userId(),
      state,
      teamIds,
    });
  const meetingTeamAccess = () => {
    const snapshot = meetingAccessSnapshot();
    if (snapshot?.documentId !== props.id || snapshot.userId !== userId())
      return false;
    const teamId = currentTeamQuery.isSuccess
      ? currentTeamQuery.data?.team?.id
      : undefined;
    return !!teamId && snapshot.teamIds.includes(teamId);
  };
  const meetingAccess = (): MeetingAccessState => {
    const snapshot = meetingAccessSnapshot();
    return snapshot?.documentId === props.id && snapshot.userId === userId()
      ? snapshot.state
      : 'loading';
  };
  const canManageMeetingLinks = () =>
    props.blockAlias === 'md' &&
    props.itemType === 'document' &&
    !!userId() &&
    (props.owner ?? requests.state()?.owner) === userId();
  const meetingAccessForSharing = ():
    | MeetingAccessState
    | 'unknown'
    | undefined => {
    if (!canManageMeetingLinks()) return undefined;
    // Turning off the UI does not revoke grants. Keep known sharing visible and
    // avoid claiming privacy when the gated source cannot check saved links.
    if (meetingAccess() === 'shared') return 'shared';
    const flag = meetingNotesFlag();
    if (flag.loading) return 'loading';
    return flag.enabled ? meetingAccess() : 'unknown';
  };
  // Like a document, a pipeline is shared by anyone who can edit it. Only its
  // owner changes team access, which `teamShareControls` still requires.
  const canSharePipeline = () =>
    props.userPermissions === Permissions.OWNER ||
    props.userPermissions === Permissions.CAN_EDIT;
  const canForward = () =>
    props.itemType === 'external_chat'
      ? false
      : props.itemType === 'crm_pipeline'
        ? canSharePipeline()
        : !RESTRICTED_SHARE_DESCRIPTIONS[props.itemType] ||
          (Boolean(userId()) && props.owner === userId());
  const userPermissions = () =>
    props.itemType === 'agent_session' && !canForward()
      ? Permissions.CAN_VIEW
      : props.userPermissions;
  /** Who manages people and channels: pipeline editors do, as owners do. */
  const recipientPermissions = () =>
    props.itemType === 'crm_pipeline' && canSharePipeline()
      ? Permissions.OWNER
      : userPermissions();
  const directSharingOwner = () =>
    props.itemType === 'external_chat' &&
    props.userPermissions === Permissions.OWNER;
  const editPermissionEnabled = () => {
    if (props.itemType === 'agent_session') return true;
    if (
      props.itemType === 'document' &&
      props.blockAlias !== 'external_chat' &&
      resolveBlockAlias(props.blockAlias) === 'md'
    )
      return ENABLE_MARKDOWN_LIVE_COLLABORATION;
    return undefined;
  };

  const [recipientScrollRef, setRecipientScrollRef] =
    createSignal<HTMLElement>();

  const copyEntityLink = useCopyLink();

  const copyLink = createCallback(() => {
    if (props.copyLink) return props.copyLink();
    fireAndForget(
      copyEntityLink(shareUrl(props.blockAlias, props.id), {
        subtext: RESTRICTED_SHARE_DESCRIPTIONS[props.itemType]
          ? undefined
          : SHARE_LINK_SUBTEXT,
      }),
      'share-modal'
    );
  });

  const sharedChannels = createMemo(
    () => sharedChannelIds(sharePermission()),
    undefined,
    {
      equals: (a, b) =>
        a.length === b.length && a.every((id, i) => id === b[i]),
    }
  );
  const channelNamesQuery = useQuery(() =>
    shareChannelNamesQueryOptions(sharedChannels())
  );

  // Create a map of channel IDs to channel names
  const channelNameMap = createMemo(() => {
    const data = channelNamesQuery.isPending
      ? undefined
      : channelNamesQuery.data;
    const map = new Map();
    if (!data) return map;

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

  const recipients = createMemo(
    () => sharePermission()?.channelSharePermissions
  );

  // A viewer who does not own the item cannot read its other grants, so the
  // roster is just the owner and must not be titled as the full audience.
  const ownerOnlyRoster = () =>
    !!props.owner &&
    props.owner !== userId() &&
    (recipients()?.length ?? 0) === 0 &&
    !props.hasDirectShares;

  // Function to navigate to a channel
  const navigateToChannel = createCallback((channelId: string) => {
    navigate(`/channel/${channelId}`);
    props.onOpenChange(false); // Close the dialog after navigation
  });

  const removeChannelAccess = createCallback(async (channelId: string) => {
    if (recipientPermissions() !== Permissions.OWNER) return;
    // An external chat reaches a channel only by mention; its owner revokes it.
    if (props.itemType === 'external_chat') {
      const result = await updateExternalChatPermissions(props.id, {
        channelSharePermissions: [{ operation: 'remove', channelId }],
      });
      if (result.isOk()) {
        fireAndForget(refetch(), 'share-modal');
        toast.success('Removed channel access');
      } else {
        toast.alert('Failed to remove channel access', {
          subtext: 'Please try again',
        });
      }
    } else if (usesGraphqlSharePolicy(props.itemType)) {
      const result = await updateEntitySharePolicy(props.itemType, props.id, {
        channelSharePermissions: [{ operation: 'remove', channelId }],
      });
      if (result.isOk()) {
        fireAndForget(refetch(), 'share-modal');
        toast.success(
          props.itemType === 'project'
            ? 'Removed folder access'
            : 'Removed channel access'
        );
      } else {
        toast.alert('Failed to remove channel access', {
          subtext: 'Please try again',
        });
      }
    } else if (props.itemType === 'crm_pipeline') {
      const result = await updatePipelineSharePermissions(props.id, {
        channelSharePermissions: [{ operation: 'remove', channelId }],
      });
      if (result.isOk()) {
        fireAndForget(refetch(), 'share-modal');
        toast.success('Removed channel access');
      } else {
        toast.alert('Failed to remove channel access', {
          subtext: 'Please try again',
        });
      }
    } else if (props.itemType === 'agent_session') {
      const result = await updateAgentSessionSharePermissions(props.id, {
        channelSharePermissions: [{ operation: 'remove', channelId }],
      });
      if (result.isOk()) {
        fireAndForget(refetch(), 'share-modal');
        toast.success('Removed channel access');
      } else {
        toast.alert('Failed to remove channel access', {
          subtext: 'Please try again',
        });
      }
    } else if (props.itemType === 'initiative') {
      const result = await updateInitiativeSharePermissions(props.id, {
        channelSharePermissions: [{ operation: 'remove', channelId }],
      });
      if (result.isOk()) {
        fireAndForget(refetch(), 'share-modal');
        toast.success('Removed channel access', {
          subtext: 'Channel no longer has access to this project',
        });
      } else {
        toast.alert('Failed to remove channel access', {
          subtext: 'Please try again',
        });
        console.error(result);
      }
    } else if (props.itemType === 'database') {
      const result = await updateDatabaseSharePermissions({
        id: props.id,
        channelSharePermissions: [{ operation: 'remove', channelId }],
      });
      if (result.isOk()) {
        await refetch();
        toast.success('Removed channel access');
      } else {
        toast.alert('Failed to remove channel access', {
          subtext: 'Please try again',
        });
      }
    } else if (props.itemType === 'form') {
      const result = await updateFormSharePermissions({
        id: props.id,
        channelSharePermissions: [{ operation: 'remove', channelId }],
      });
      if (result.isOk()) {
        await refetch();
        toast.success('Removed channel access', {
          subtext: 'Its members can no longer respond',
        });
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
        fireAndForget(refetch(), 'share-modal');
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
        fireAndForget(refetch(), 'share-modal');
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
        fireAndForget(refetch(), 'share-modal');
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
      if (
        recipientPermissions() !== Permissions.OWNER ||
        props.itemType === 'external_chat'
      )
        return;

      let result:
        | Result<any, ResultError<any>[]>
        | Result<void, ResultError<any>[]>
        | null = null;
      if (usesGraphqlSharePolicy(props.itemType)) {
        result = await updateEntitySharePolicy(props.itemType, props.id, {
          channelSharePermissions: [
            { operation: 'replace', accessLevel, channelId },
          ],
        });
      } else if (props.itemType === 'crm_pipeline') {
        result = await updatePipelineSharePermissions(props.id, {
          channelSharePermissions: [
            { operation: 'replace', accessLevel, channelId },
          ],
        });
      } else if (props.itemType === 'agent_session') {
        result = await updateAgentSessionSharePermissions(props.id, {
          channelSharePermissions: [
            { operation: 'replace', accessLevel, channelId },
          ],
        });
      } else if (props.itemType === 'initiative') {
        result = await updateInitiativeSharePermissions(props.id, {
          channelSharePermissions: [
            { operation: 'replace', accessLevel, channelId },
          ],
        });
      } else if (props.itemType === 'database') {
        result = await updateDatabaseSharePermissions({
          id: props.id,
          channelSharePermissions: [
            { operation: 'replace', accessLevel, channelId },
          ],
        });
      } else if (props.itemType === 'form') {
        result = await updateFormSharePermissions({
          id: props.id,
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
        fireAndForget(refetch(), 'share-modal');
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

  const linkShare = createMemo(() => sharePermission()?.linkShare);

  const linkShareAccessLevel = createMemo(
    () => sharePermission()?.linkShareAccessLevel
  );

  const teamShareAccessLevel = createMemo(() => {
    if (props.itemType === 'call') {
      if (!callRecordQuery.isSuccess) return;
      const record = callRecordQuery.data;
      if (!record) return;
      return sharePermissionFromCallRecord(record).teamShareAccessLevel;
    }
    return sharePermission()?.teamShareAccessLevel;
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
      if (props.itemType === 'external_chat') {
        result = await updateExternalChatPermissions(props.id, sharePermission);
      } else if (
        props.itemType !== 'call' &&
        usesGraphqlSharePolicy(props.itemType)
      ) {
        result = await updateEntitySharePolicy(
          props.itemType,
          props.id,
          sharePermission
        );
      } else if (props.itemType === 'crm_pipeline') {
        result = await updatePipelineTeamShare(props.id, shared);
      } else if (props.itemType === 'agent_session') {
        result = await updateAgentSessionSharePermissions(
          props.id,
          sharePermission
        );
      } else if (props.itemType === 'initiative') {
        result = await updateInitiativeSharePermissions(
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
      } else if (props.itemType === 'database') {
        result = await updateDatabaseSharePermissions({
          id: props.id,
          ...sharePermission,
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

      fireAndForget(refetch(), 'share-modal');
      const scope = getTeamShareScope(sharePermission.teamShareAccessLevel);
      if (props.itemType === 'call') {
        setCallRecordTeamShareCache(props.id, shared);
      }
      if (scope === 'NONE') {
        toast.success(
          canManageMeetingLinks()
            ? `Removed direct team access for this ${itemNoun}`
            : `Removed team access for this ${itemNoun}`
        );
        return;
      }

      toast.success('Updated team access', {
        subtext: `The owner's team can ${scope} this ${itemNoun}`,
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

  // Calls read team access from their record; everything else waits for its
  // permissions so the control never shows "None" before the real level.
  const teamShareControls = (): TeamShareControls | undefined =>
    canShareWithTeam() &&
    (props.itemType === 'call' || !permissionsLoading()) &&
    userPermissions() === Permissions.OWNER &&
    currentTeamQuery.isSuccess &&
    currentTeamQuery.data
      ? {
          accessLevel: teamShareAccessLevel(),
          meetingViewAccess: canManageMeetingLinks() && meetingTeamAccess(),
          meetingAccess: meetingAccessForSharing(),
          setAccessLevel: setTeamShareAccessLevel,
          itemNoun:
            props.blockAlias === 'snippet'
              ? 'snippet'
              : getShareItemNoun(props.itemType),
          scopeOptions: teamShareScopeOptionsForItem(props.itemType),
        }
      : undefined;

  const updateLinkSharePermissions = createCallback(
    async (sharePermission: LinkSharePayload) => {
      if (userPermissions() !== Permissions.OWNER) return;
      const scope = getLinkShareScope(sharePermission.linkShare);
      let result: Result<any, ResultError<any>[]> | undefined;

      if (props.itemType === 'external_chat') {
        result = await updateExternalChatPermissions(props.id, sharePermission);
      } else if (usesGraphqlSharePolicy(props.itemType)) {
        result = await updateEntitySharePolicy(
          props.itemType,
          props.id,
          sharePermission
        );
      } else if (props.itemType === 'agent_session') {
        result = await updateAgentSessionSharePermissions(
          props.id,
          sharePermission
        );
      } else if (props.itemType === 'initiative') {
        result = await updateInitiativeSharePermissions(
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

      fireAndForget(refetch(), 'share-modal');
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

  return (
    <Show
      when={!isMobile()}
      fallback={
        <MobileShareDrawer
          meetingNotesEnabled={meetingNotesFlag().enabled}
          meetingAccess={meetingAccessForSharing()}
          onMeetingAccessState={setMeetingAccess}
          requests={requests}
          requestLevels={requestLevels()}
          directPeopleIds={props.directPeopleIds}
          editPermissionEnabled={editPermissionEnabled()}
          canForward={canForward()}
          ownerOnlyRoster={ownerOnlyRoster()}
          isOpen={props.open}
          setIsOpen={props.onOpenChange}
          blockAlias={props.blockAlias}
          name={props.name}
          id={props.id}
          itemType={props.itemType}
          owner={props.owner ?? requests.state()?.owner ?? undefined}
          people={props.people}
          linkSharing={props.linkSharing}
          hasDirectShares={
            props.hasDirectShares || requests.grants().length > 0
          }
          userPermissions={recipientPermissions()}
          recipients={recipients()}
          channelNameMap={channelNameMap()}
          linkShare={linkShare()}
          linkShareAccessLevel={linkShareAccessLevel()}
          teamShare={teamShareControls()}
          permissionsLoading={permissionsLoading()}
          refetch={refetch}
          navigateToChannel={navigateToChannel}
          removeChannelAccess={removeChannelAccess}
          setChannelPermissions={setChannelPermissions}
          setLinkShareScope={setLinkShareScope}
          setLinkShareAccessLevel={setLinkShareAccessLevel}
          copyLink={copyLink}
        />
      }
    >
      <Dialog onOpenChange={props.onOpenChange} open={props.open}>
        <Dialog.Portal>
          <Dialog.Overlay class="z-modal fixed inset-0 scrim-glass" />
          <div class="z-modal fixed inset-0">
            <Dialog.Content
              class="max-w-[calc(100vw-16px)] mt-20 sm:mt-40 mx-auto overflow-y-auto scrollbar-hidden portal-scope isolate flex flex-col gap-2 *:max-h-[75vh]"
              style={{ width: '800px' }}
            >
              {/* Card 1: Share form — gradient border */}
              <Panel
                depth={2}
                hideBorder
                class="elevated-surface rounded-[24px] bg-dialog"
              >
                <Panel.Header class="px-4">
                  <Dialog.Title class="flex items-center gap-1.5 min-w-0 overflow-hidden whitespace-nowrap w-full text-sm font-medium">
                    <span class="shrink-0">Share:</span>
                    <EntityIcon
                      targetType={props.blockAlias}
                      size="sm"
                      class="shrink-0"
                    />
                    <span class="truncate">{props.name}</span>
                  </Dialog.Title>
                </Panel.Header>
                <Panel.Body>
                  <Show when={!canForward() && !directSharingOwner()}>
                    <p class="px-4 py-3 text-sm text-ink-muted">
                      {RESTRICTED_SHARE_DESCRIPTIONS[props.itemType]}
                    </p>
                  </Show>
                  <Show when={directSharingOwner()}>
                    <DirectAccessInvite
                      source={requests}
                      description="Invite someone to read this conversation. Sending requires their own connected account."
                    />
                  </Show>
                  <Show when={canForward()}>
                    <AfterFirstPaint fallback={<ShareFormSkeleton />}>
                      <ForwardToChannel
                        {...forwardTarget(
                          props.blockAlias,
                          props.id,
                          setChannelPermissions
                        )}
                        editPermissionEnabled={editPermissionEnabled()}
                        submitPermissionInfo={{
                          setChannelPermissions: (id, accessLevel) =>
                            setChannelPermissions(id, accessLevel, true),
                          userPermissions: recipientPermissions(),
                          channelSharePermissions: recipients(),
                        }}
                        onSubmit={() => props.onOpenChange(false)}
                        onCancel={() => props.onOpenChange(false)}
                        refetch={refetch}
                        name={props.name}
                        hideAccessLevelSelector={props.itemType === 'email'}
                        initialAccessLevel={
                          props.itemType === 'email' ? 'view' : null
                        }
                        allowedAccessLevels={shareLevelsFor(
                          props.itemType,
                          props.blockAlias
                        )}
                      />
                    </AfterFirstPaint>
                  </Show>
                  <Show when={!canForward()}>
                    <div class="flex justify-end px-4 py-3">
                      <Button variant="secondary" onClick={copyLink}>
                        <CopyIcon class="size-4" />
                        <span>Copy Link</span>
                      </Button>
                    </div>
                  </Show>
                </Panel.Body>
              </Panel>

              <AccessRequestError source={requests} />
              <Show
                when={
                  requests.state()?.canReview &&
                  (requests.state()?.pendingCount ?? 0) > 0
                }
              >
                <Panel
                  depth={2}
                  hideBorder
                  class="elevated-surface rounded-[24px] bg-dialog"
                >
                  <Panel.Body>
                    <PermissionRequestsView source={requests} />
                  </Panel.Body>
                </Panel>
              </Show>

              {/* Card 2: Recipients — plain border */}
              <Show
                when={
                  (recipients()?.length ?? 0) > 0 ||
                  !!(props.owner ?? requests.state()?.owner) ||
                  permissionsLoading()
                }
              >
                <Panel
                  depth={2}
                  hideBorder
                  class="elevated-surface rounded-[24px] bg-dialog"
                >
                  <Panel.Header class="px-4">
                    <span class="text-sm font-medium">
                      <Show when={!ownerOnlyRoster()} fallback="Owner">
                        People with access to this{' '}
                        {getShareItemNoun(props.itemType)}
                      </Show>
                    </span>
                  </Panel.Header>
                  <Panel.Body class="text-ink">
                    <div class="relative">
                      <ScrollIndicators
                        scrollRef={recipientScrollRef}
                        noBorderStart
                        noBorderEnd
                      />
                      <CustomScrollbar scrollContainer={recipientScrollRef} />
                      <div
                        class="overflow-y-auto scrollbar-hidden max-h-[calc(27vh-40px)]"
                        ref={setRecipientScrollRef}
                      >
                        <div class="grid gap-3 text-ink text-sm select-none p-4">
                          <Show when={props.owner ?? requests.state()?.owner}>
                            <div class="flex justify-between">
                              <div class="flex items-center gap-2 overflow-hidden font-medium">
                                <OwnerLabel
                                  ownerId={
                                    props.owner ??
                                    requests.state()?.owner ??
                                    undefined
                                  }
                                  viewerLabel="Me"
                                />
                              </div>
                              <div class="flex items-center">
                                <div class="font-medium text-ink-muted text-xs">
                                  Owner
                                </div>
                              </div>
                            </div>
                          </Show>
                          <RequestAccessView
                            source={requests}
                            allowedLevels={requestLevels()}
                          />
                          <DirectAccessView
                            source={requests}
                            exclude={props.directPeopleIds}
                          />
                          <Dynamic component={props.people} />
                          <Show when={permissionsLoading()}>
                            <RecipientsSkeleton />
                          </Show>
                          <For each={recipients() || []}>
                            {(recipient) => (
                              <div class="flex justify-between">
                                <div
                                  class="flex items-center gap-2 overflow-hidden"
                                  onClick={() =>
                                    navigateToChannel(recipient.channel_id)
                                  }
                                >
                                  <Switch
                                    fallback={
                                      <UsersIcon class="shrink-0 size-4" />
                                    }
                                  >
                                    <Match
                                      when={
                                        channelNameMap().get(
                                          recipient.channel_id
                                        )?.type === 'direct_message'
                                      }
                                    >
                                      <DmRecipientIcon
                                        channelId={recipient.channel_id}
                                      />
                                    </Match>
                                    <Match
                                      when={channelNameMap().get(
                                        recipient.channel_id
                                      )}
                                    >
                                      <UsersIcon class="shrink-0 size-4" />
                                    </Match>
                                  </Switch>
                                  <div class="font-medium truncate">
                                    <Show
                                      when={
                                        channelNameMap().get(
                                          recipient.channel_id
                                        )?.type !== 'direct_message'
                                      }
                                      fallback={
                                        channelNameMap().get(
                                          recipient.channel_id
                                        )?.name || 'Conversation'
                                      }
                                    >
                                      <GroupChannelLabel
                                        channelId={recipient.channel_id}
                                        fallbackName={
                                          channelNameMap().get(
                                            recipient.channel_id
                                          )?.name || 'Conversation'
                                        }
                                      />
                                    </Show>
                                  </div>
                                  <Show when={props.itemType === 'form'}>
                                    <span class="shrink-0 text-xs text-ink-muted">
                                      Can respond (channel)
                                    </span>
                                  </Show>
                                </div>
                                <div class="flex items-center">
                                  <ShareOptions
                                    editPermissionEnabled={editPermissionEnabled()}
                                    allowedAccessLevels={shareLevelsFor(
                                      props.itemType,
                                      props.blockAlias
                                    )}
                                    disabled={
                                      recipientPermissions() !==
                                      Permissions.OWNER
                                    }
                                    permissions={recipient.access_level}
                                    setPermissions={(accessLevel) => {
                                      if (accessLevel === null) {
                                        fireAndForget(
                                          removeChannelAccess(
                                            recipient.channel_id
                                          ),
                                          'share-modal'
                                        );
                                      } else if (
                                        accessLevel !== recipient.access_level
                                      ) {
                                        fireAndForget(
                                          setChannelPermissions(
                                            recipient.channel_id,
                                            accessLevel
                                          ),
                                          'share-modal'
                                        );
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </div>
                  </Panel.Body>
                </Panel>
              </Show>

              {/* Card 3: Link sharing — plain border */}
              <Show
                when={
                  props.open &&
                  meetingNotesFlag().enabled &&
                  props.blockAlias === 'md' &&
                  props.itemType === 'document' &&
                  !!userId() &&
                  (props.owner ?? requests.state()?.owner) === userId()
                }
              >
                <DocumentMeetingNotes
                  documentId={props.id}
                  onAccessState={setMeetingAccess}
                />
              </Show>
              <Show
                when={
                  props.linkSharing ||
                  (userPermissions() === Permissions.OWNER &&
                    !isLinkSharingDisabledForItem(props.itemType))
                }
              >
                <Panel
                  depth={2}
                  hideBorder
                  class="elevated-surface rounded-[24px] bg-dialog"
                >
                  <Panel.Body>
                    <Show
                      when={props.linkSharing}
                      fallback={
                        <LinkSharingControls
                          allowedAccessLevels={shareLevelsFor(
                            props.itemType,
                            props.blockAlias
                          )}
                          loading={permissionsLoading()}
                          meetingAccess={meetingAccessForSharing()}
                          editPermissionEnabled={editPermissionEnabled()}
                          linkShare={linkShare()}
                          linkShareAccessLevel={linkShareAccessLevel()}
                          hasExplicitShares={
                            (recipients()?.length ?? 0) > 0 ||
                            !!props.hasDirectShares ||
                            requests.grants().length > 0
                          }
                          setLinkShareScope={setLinkShareScope}
                          setLinkShareAccessLevel={setLinkShareAccessLevel}
                          copyLink={copyLink}
                          teamShare={teamShareControls()}
                        />
                      }
                    >
                      <div class="p-4">
                        <Dynamic component={props.linkSharing} />
                      </div>
                    </Show>
                  </Panel.Body>
                </Panel>
              </Show>
              <Show
                when={teamShareOnOwnCard(props.itemType, teamShareControls())}
              >
                {(teamShare) => (
                  <Panel
                    depth={2}
                    hideBorder
                    class="elevated-surface rounded-[24px] bg-dialog"
                  >
                    <Panel.Body>
                      <div class="p-4 text-sm text-ink">
                        <TeamAccessSection teamShare={teamShare()} />
                      </div>
                    </Panel.Body>
                  </Panel>
                )}
              </Show>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog>
    </Show>
  );
}

export function ShareTrigger(props: {
  onClick: () => void;
  id?: string;
  blockType?: ShareBlockType;
  hotkeyScope?: string;
  copyLink?: () => void;
  size?: 'sm' | 'md';
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

  const blockType = (): ShareBlockType => {
    const type = props.blockType ?? contextualBlockType;
    if (type) return type;
    throw new Error('<ShareTrigger> requires an explicit block type');
  };
  const blockId = (): string => {
    const id = props.id ?? contextualBlockId;
    if (id) return id;
    throw new Error('<ShareTrigger> requires an explicit block id');
  };

  const itemType = (): ShareItemType => {
    const type = blockType();
    return type === 'initiative' || type === 'external_chat'
      ? type
      : blockNameToItemType(type);
  };

  // Hovering or focusing Share loads what the dialog shows first, so a click
  // opens it with its roster instead of waiting on the network.
  const warmShareDialog = () => {
    if (!isAuthenticated()) return;
    if (inBlock) {
      const result = permissionsBlockResource[0].latest;
      fireAndForget(
        prefetchShareChannelNames(
          sharedChannelIds(result && !result.isErr() ? result.value : undefined)
        ),
        'share-modal'
      );
      return;
    }
    fireAndForget(
      prefetchSharePermissions(blockId(), itemType()),
      'share-modal'
    );
  };

  const panel = useSplitPanel();
  const requests = useShareRequestTrigger({
    entity: () => shareEntity(itemType(), blockId()),
    active: () => !panel?.isInlinePreview && (panel?.isPanelActive() ?? false),
    open: () => props.onClick(),
  });

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
          requests.open();
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
    const result = copyEntityLink(shareUrl(blockType(), blockId()), {
      subtext:
        blockType() === 'agent' || blockType() === 'initiative'
          ? undefined
          : SHARE_LINK_SUBTEXT,
    });
    analytics.track('copy_share_link', { blockType: blockType() });
    return result;
  });

  const ShareLinkAction = createMemo(() => ({
    action: (e: MouseEvent | KeyboardEvent) => {
      e.stopPropagation();
      return copyLink();
    },
    icon: IconLink,
  }));

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
  const iconSize = () =>
    isTouchDevice() || props.size === 'md' ? 'icon-md' : 'icon-sm';

  return (
    <HeaderActionGroup label="Sharing" size={props.size}>
      <div
        ref={requests.ref}
        class="flex items-stretch touch:items-center touch:gap-1"
        onPointerEnter={warmShareDialog}
        onFocusIn={warmShareDialog}
      >
        <HeaderActionButton
          grouped
          size={isTouchDevice() ? undefined : props.size}
          label="Share"
          tooltip={
            shareStatus()?.tooltip ??
            (blockType() === 'agent'
              ? 'Share agent session'
              : blockType() === 'initiative'
                ? 'Share project'
                : inBlock
                  ? 'This item has been shared with you.'
                  : `Share ${blockType()}`)
          }
          icon={
            <ShareRequestIcon count={requests.count()}>
              <IconShared class="size-4" />
            </ShareRequestIcon>
          }
          onClick={() => {
            if (!isAuthenticated()) {
              openLoginModal();
            } else {
              analytics.track('share_menu_open', { blockType: blockType() });
              requests.open();
            }
          }}
        />

        <CopyButton
          as={ButtonGroup.Button}
          variant="ghost"
          tooltip="Copy Share Link"
          size={iconSize()}
          onClick={ShareLinkAction().action}
        >
          <Dynamic component={ShareLinkAction().icon} class="size-3.5" />
        </CopyButton>
      </div>
    </HeaderActionGroup>
  );
}

const PERMISSION_ICONS = {
  comment: IconComment,
  view: IconEye,
  edit: IconEdit,
} as const;

export function ShareOptions(props: {
  editPermissionEnabled?: boolean;
  setPermissions: (accessLevel: AccessLevel | null) => void;
  permissions?: AccessLevel | null;
  hideNoAccess?: boolean;
  label?: string | '';
  disabled?: boolean;
  noBorder?: boolean;
  /** Grants this recipient can hold; removal stays governed by `hideNoAccess`. */
  allowedAccessLevels?: readonly AccessLevel[];
}) {
  const blockEditPermissionEnabled = isInBlock()
    ? blockEditPermissionEnabledSignal
    : () => true;
  const editPermissionEnabled = () =>
    props.editPermissionEnabled ?? blockEditPermissionEnabled();
  const blockName = isInBlock() ? useBlockName() : undefined;

  const options = createMemo(() => {
    const optionsList: { value: string; label: string }[] = [];

    // Always add view option
    optionsList.push({
      value: 'view',
      label: `Can ${accessLevelText('view').toLowerCase()}`,
    });

    // Add comment option if applicable
    if (blockName !== 'md' || ENABLE_MARKDOWN_COMMENTS) {
      optionsList.push({
        value: 'comment',
        label: `Can ${accessLevelText('comment').toLowerCase()}`,
      });
    }

    // Add edit option if enabled
    if (editPermissionEnabled()) {
      optionsList.push({
        value: 'edit',
        label: `Can ${accessLevelText('edit').toLowerCase()}`,
      });
    }

    // Add no access option if not hidden
    if (!props.hideNoAccess) {
      optionsList.push({ value: 'none', label: accessLevelText(null) });
    }

    const allowed = props.allowedAccessLevels;
    return allowed
      ? optionsList.filter(
          (option) =>
            option.value === 'none' ||
            allowed.includes(option.value as AccessLevel)
        )
      : optionsList;
  });

  const currentValue = createMemo(() => {
    if (props.permissions === null) return 'none';
    return props.permissions || 'none';
  });

  const currentValueText = createMemo(() => {
    const value = currentValue();
    if (value === 'none') return accessLevelText(null);
    return (
      options().find((option) => option.value === value)?.label ??
      accessLevelText(value as AccessLevel)
    );
  });

  const CurrentIcon = createMemo(() => {
    const value = currentValue();
    if (value === 'none') return IconX;
    return PERMISSION_ICONS[value as keyof typeof PERMISSION_ICONS];
  });

  const [isOpen, setIsOpen] = createSignal(false);

  const handleChange = (value: string) => {
    setIsOpen(false);
    if (value === 'none') {
      props.setPermissions(null);
    } else {
      props.setPermissions(value as AccessLevel);
    }
  };

  return (
    <Dropdown modal={false} open={isOpen()} onOpenChange={setIsOpen}>
      <Dropdown.Trigger
        variant="secondary"
        disabled={props.disabled}
        class={`min-w-16.75 py-1 pl-2 pr-1 flex items-center gap-1 ${props.noBorder ? 'border-0 sm:border' : ''}`}
        on:keydown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
      >
        <Dynamic component={CurrentIcon()} class="size-4 shrink-0" />
        {currentValueText()}
        <ChevronDownIcon class="size-4 text-ink-extra-muted" />
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local">
        <Dropdown.RadioGroup value={currentValue()} onChange={handleChange}>
          <Dropdown.Group>
            <For each={options().filter((o) => o.value !== 'none')}>
              {(option) => {
                const Icon =
                  PERMISSION_ICONS[
                    option.value as keyof typeof PERMISSION_ICONS
                  ];
                return (
                  <Dropdown.RadioItem value={option.value}>
                    <div class="size-4 shrink-0">
                      {Icon && <Icon class="size-full" />}
                    </div>
                    <span class="flex-1 truncate">{option.label}</span>
                    <Dropdown.ItemIndicator>
                      <CheckIcon class="size-3.5 text-accent" />
                    </Dropdown.ItemIndicator>
                  </Dropdown.RadioItem>
                );
              }}
            </For>
          </Dropdown.Group>
          <Show when={!props.hideNoAccess}>
            <Dropdown.Group>
              <Dropdown.RadioItem value="none">
                <div class="size-4 shrink-0">
                  <IconX class="size-full" />
                </div>
                <span class="flex-1 truncate">{accessLevelText(null)}</span>
                <Dropdown.ItemIndicator>
                  <CheckIcon class="size-3.5 text-accent" />
                </Dropdown.ItemIndicator>
              </Dropdown.RadioItem>
            </Dropdown.Group>
          </Show>
        </Dropdown.RadioGroup>
      </Dropdown.Content>
    </Dropdown>
  );
}
