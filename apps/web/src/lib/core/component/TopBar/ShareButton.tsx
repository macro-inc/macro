import {
  fetchPipelineSharePermissions,
  updatePipelineSharePermissions,
  updatePipelineTeamShare,
} from '@app/features/crm/sharing-adapter';
import { projectRouteId } from '@app/features/projects/core/route';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useChannelParticipants } from '@channel/use-channel-participants';
import { HeaderActionButton } from '@components/app/HeaderActionButton';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
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
import { type TabItem, Tabs } from '@core/component/Tabs';
import { UserIcon } from '@core/component/UserIcon';
import { ENABLE_MARKDOWN_COMMENTS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import clickOutside from '@core/directive/clickOutside';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { blockEditPermissionEnabledSignal } from '@core/signal/load';
import { useIsDocumentOwner } from '@core/signal/permissions';
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
import GlobeIcon from '@icon/system/regular/globe.svg';
import IconLink from '@icon/system/regular/link.svg';
import LockIcon from '@icon/system/regular/lock-simple.svg';
import IconEdit from '@icon/system/regular/pencil.svg';
import UserCircle from '@icon/system/regular/user-circle.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import IconX from '@icon/system/regular/x.svg';
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
import {
  fetchInitiativeSharePermissions,
  updateInitiativeSharePermissions,
} from '@queries/initiative/share-permissions';
import {
  getDatabaseSharePermissions,
  updateDatabaseSharePermissions,
} from '@queries/storage/databases';
import {
  getFormSharePermissions,
  updateFormSharePermissions,
} from '@queries/storage/forms';
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
import {
  Button,
  CommandMenuShell,
  CopyButton,
  cn,
  Dialog,
  Dropdown,
  type ManagedDialogProps,
  Tooltip,
} from '@ui';
import type { Result } from 'neverthrow';
import {
  type Component,
  type ComponentProps,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
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
type ShareBlockType = BlockName | BlockAlias | 'initiative';

function shareUrl(type: ShareBlockType, id: string): string {
  if (type !== 'initiative') return buildSimpleEntityUrl({ type, id });
  return buildSimpleEntityUrl({
    type: 'component',
    id: projectRouteId({ id, section: 'overview' }),
  });
}

/** The levels a recipient can hold on an item; forms have no comments. */
export function shareLevelsFor(
  itemType: ShareItemType
): readonly AccessLevel[] | undefined {
  return itemType === 'form' ? ['view', 'edit'] : undefined;
}

async function fetchSharePermissions(id: string, itemType: ShareItemType) {
  if (itemType === 'crm_pipeline') return fetchPipelineSharePermissions(id);
  if (itemType === 'agent_session') {
    return fetchAgentSessionSharePermissions(id);
  }
  if (itemType === 'initiative') {
    return fetchInitiativeSharePermissions(id);
  }
  if (itemType === 'database') return getDatabaseSharePermissions(id);
  if (itemType === 'form') return getFormSharePermissions(id);
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

// Only these items' owners (a pipeline's editors) can grant access, so only
// they may forward. Their links don't grant access to recipients either, so
// copying skips SHARE_LINK_SUBTEXT.
const RESTRICTED_SHARE_DESCRIPTIONS: Partial<Record<ShareItemType, string>> = {
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
        return 'Can view';
      }
      return 'Can comment';
    case 'view':
      return 'Can view';
    case 'edit':
      return 'Can edit';
    case 'owner':
      return 'Owner';
    default:
      return 'Remove access';
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
  linkShare: LinkShare | null | undefined;
  linkShareAccessLevel: AccessLevel | null | undefined;
  hasExplicitShares: boolean;
  setLinkShareScope: (scope: LinkShareScope) => void;
  setLinkShareAccessLevel: (accessLevel: AccessLevel | null) => void;
  copyLink: () => void;
  hideCopyLink?: boolean;
  teamShare?: TeamShareControls;
}

/** Owner-only explicit team sharing, present only for entity types that support it. */
interface TeamShareControls {
  accessLevel: AccessLevel | null | undefined;
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

  return (
    <div class="flex items-start justify-between gap-4">
      <div class="flex flex-col gap-1">
        <span class="font-medium">Team access</span>
        <p class="text-sm text-ink-muted">
          Give everyone on the owner's team access to this{' '}
          {props.teamShare.itemNoun} without needing a link.
        </p>
      </div>
      <Dropdown>
        <Dropdown.Trigger
          variant="outline"
          aria-label="Team access"
          class="shrink-0 flex items-center gap-1 rounded-lg px-2.5 py-1.5"
        >
          {getTeamShareScopeCopy(teamShareScope())}
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
                  <span class="flex-1 truncate">{option.label}</span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5 text-ink" />
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
  const ScopeIcon = () =>
    scope() === 'PUBLIC'
      ? GlobeIcon
      : scope() === 'TEAM'
        ? UsersIcon
        : LockIcon;

  return (
    <div class="flex flex-col gap-4 px-6 py-6 text-sm text-ink">
      <h3 class="font-medium">Link access</h3>
      <div class="flex items-start gap-3">
        <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-hover text-ink">
          <Dynamic component={ScopeIcon()} class="size-4" />
        </div>
        <div class="min-w-0 flex-1">
          <Dropdown>
            <Dropdown.Trigger
              variant="ghost"
              aria-label="Who can open this link"
              class="-ml-2 flex max-w-full items-center gap-1 rounded-lg px-2 py-1 font-medium"
            >
              <span class="truncate">{scopeCopy().label}</span>
              <ChevronDownIcon class="size-3.5 shrink-0 text-ink-muted" />
            </Dropdown.Trigger>
            <Dropdown.Content
              portalScope="local"
              class="max-w-[calc(100vw-48px)] w-80"
            >
              <Dropdown.RadioGroup
                aria-label="Link sharing scope"
                value={scope()}
                onChange={(value) =>
                  props.setLinkShareScope(value as LinkShareScope)
                }
              >
                <For each={LINK_SHARE_SCOPE_OPTIONS}>
                  {(option) => (
                    <Dropdown.RadioItem
                      value={option.value}
                      class="items-start py-2.5"
                    >
                      <div class="min-w-0 flex-1">
                        <div class="font-medium">{option.label}</div>
                        <div class="mt-1 text-xs leading-relaxed text-ink-muted whitespace-normal">
                          {getLinkShareScopeCopy(option.value).description}
                        </div>
                      </div>
                      <Dropdown.ItemIndicator>
                        <CheckIcon class="mt-0.5 size-3.5" />
                      </Dropdown.ItemIndicator>
                    </Dropdown.RadioItem>
                  )}
                </For>
              </Dropdown.RadioGroup>
            </Dropdown.Content>
          </Dropdown>
        </div>
        <Show when={scope() !== 'NONE'}>
          <ShareOptions
            editPermissionEnabled={props.editPermissionEnabled}
            permissions={props.linkShareAccessLevel ?? 'view'}
            hideNoAccess
            setPermissions={props.setLinkShareAccessLevel}
          />
        </Show>
      </div>
      <Show when={props.teamShare}>
        {(teamShare) => (
          <details class="group" open={teamShare().accessLevel != null}>
            <summary class="flex items-center gap-1 text-xs text-ink-muted list-none hover:text-ink">
              More access options
              <ChevronDownIcon class="size-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div class="pt-4">
              <TeamAccessSection teamShare={teamShare()} />
            </div>
          </details>
        )}
      </Show>
      <Show when={!props.hideCopyLink}>
        <Button variant="outline" onClick={props.copyLink}>
          <IconLink class="size-4" />
          Copy link
        </Button>
      </Show>
    </div>
  );
}

interface MobileShareDrawerProps {
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
  userPermissions: Permissions;
  recipients: SharePermissionV2ChannelSharePermissions | undefined;
  channelNameMap: Map<string, { name: string; type: string }>;
  linkShare: LinkShare | null | undefined;
  linkShareAccessLevel: AccessLevel | null | undefined;
  teamShare?: TeamShareControls;
  refetch: () => void;
  navigateToChannel: (channelId: string) => void;
  removeChannelAccess: (channelId: string) => void;
  setChannelPermissions: ChannelPermissionSetter;
  setLinkShareScope: (scope: LinkShareScope) => void;
  setLinkShareAccessLevel: (accessLevel: AccessLevel | null) => void;
  copyLink: () => void;
}

function MobileShareDrawer(props: MobileShareDrawerProps) {
  const [activeTab, setActiveTab] = createSignal('share');

  const wrappedSetOpen = (open: boolean) => {
    props.setIsOpen(open);
    if (!open) {
      setActiveTab('share');
    }
  };

  const mobileTabs = createMemo((): TabItem[] => {
    const tabs: TabItem[] = [{ value: 'share', label: 'Share' }];
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
    const tab = activeTab();
    return mobileTabs().find((t) => t.value === tab) ? tab : 'share';
  });

  const [forwardRef, setForwardRef] = createSignal<{
    handleSubmit: () => void;
    getSelectedOptions: () => unknown[];
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
                variant="ghost"
                size="sm"
                class="shrink-0 ml-2 pl-2 disabled:text-ink-muted text-accent"
                disabled={
                  (forwardRef()?.getSelectedOptions().length ?? 0) === 0
                }
                onClick={() => forwardRef()?.handleSubmit()}
              >
                Share
              </Button>
            </Show>
          </div>
          <div class="shrink-0 h-9 border-b border-edge-muted px-3 mb-2">
            <Tabs
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
            <Show when={!props.canForward}>
              <p class="px-4 py-3 text-sm text-ink-muted">
                {RESTRICTED_SHARE_DESCRIPTIONS[props.itemType]}
              </p>
            </Show>
            <Show when={props.canForward}>
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
                initialAccessLevel={props.itemType === 'email' ? 'view' : null}
                allowedAccessLevels={shareLevelsFor(props.itemType)}
              />
            </Show>
            <Show when={!props.canForward}>
              <div class="px-4 py-3">
                <Button variant="outline" onClick={props.copyLink}>
                  <CopyIcon class="size-4" />
                  <span>Copy link</span>
                </Button>
              </div>
            </Show>
          </div>
          <Show when={effectiveActiveTab() === 'people'}>
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
                        allowedAccessLevels={shareLevelsFor(props.itemType)}
                        disabled={props.userPermissions !== Permissions.OWNER}
                        permissions={recipient.access_level}
                        setPermissions={(accessLevel) => {
                          if (accessLevel === null) {
                            props.removeChannelAccess(recipient.channel_id);
                          } else if (accessLevel !== recipient.access_level) {
                            props.setChannelPermissions(
                              recipient.channel_id,
                              accessLevel
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
  const navigate = useNavigate();
  const analytics = useAnalytics();
  const currentTeamQuery = useCurrentTeamQuery();
  const callRecordQuery = useCallRecordQuery(() =>
    props.itemType === 'call' ? props.id : ''
  );
  // These entities are never their enclosing block's, so read their own grants.
  const isBlockContext =
    isInBlock() &&
    props.itemType !== 'agent_session' &&
    props.itemType !== 'initiative' &&
    props.itemType !== 'crm_pipeline';
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
  // Like a document, a pipeline is shared by anyone who can edit it. Only its
  // owner changes team access, which `teamShareControls` still requires.
  const canSharePipeline = () =>
    props.userPermissions === Permissions.OWNER ||
    props.userPermissions === Permissions.CAN_EDIT;
  const canForward = () =>
    props.itemType === 'crm_pipeline'
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
  const editPermissionEnabled = () =>
    props.itemType === 'agent_session' ? true : undefined;

  const [recipientScrollRef, setRecipientScrollRef] =
    createSignal<HTMLElement>();

  const copyEntityLink = useCopyLink();

  const copyLink = createCallback(() => {
    if (props.copyLink) return props.copyLink();
    copyEntityLink(shareUrl(props.blockAlias, props.id), {
      subtext: RESTRICTED_SHARE_DESCRIPTIONS[props.itemType]
        ? undefined
        : SHARE_LINK_SUBTEXT,
    });
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
    if (props.itemType === 'crm_pipeline') {
      const result = await updatePipelineSharePermissions(props.id, {
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
    } else if (props.itemType === 'agent_session') {
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
    } else if (props.itemType === 'initiative') {
      const result = await updateInitiativeSharePermissions(props.id, {
        channelSharePermissions: [{ operation: 'remove', channelId }],
      });
      if (result.isOk()) {
        refetch();
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
      if (recipientPermissions() !== Permissions.OWNER) return;

      let result:
        | Result<any, ResultError<any>[]>
        | Result<void, ResultError<any>[]>
        | null = null;
      if (props.itemType === 'crm_pipeline') {
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
      if (props.itemType === 'crm_pipeline') {
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

      if (props.itemType === 'agent_session') {
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

  return (
    <Show
      when={!isMobile()}
      fallback={
        <MobileShareDrawer
          editPermissionEnabled={editPermissionEnabled()}
          canForward={canForward()}
          ownerOnlyRoster={ownerOnlyRoster()}
          isOpen={props.open}
          setIsOpen={props.onOpenChange}
          blockAlias={props.blockAlias}
          name={props.name}
          id={props.id}
          itemType={props.itemType}
          owner={props.owner}
          people={props.people}
          linkSharing={props.linkSharing}
          hasDirectShares={props.hasDirectShares}
          userPermissions={recipientPermissions()}
          recipients={recipients()}
          channelNameMap={channelNameMap()}
          linkShare={linkShare()}
          linkShareAccessLevel={linkShareAccessLevel()}
          teamShare={teamShareControls()}
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
      <Dialog
        onOpenChange={props.onOpenChange}
        open={props.open}
        class="w-150"
        animate
      >
        <CommandMenuShell
          depth={2}
          hideBorder
          class="max-h-[min(75vh,calc(100dvh-2rem))]"
        >
          <CommandMenuShell.Header class="items-start justify-between gap-4 pl-5 pr-14 py-4 border-edge-frame">
            <div class="min-w-0">
              <Dialog.Title class="text-lg font-semibold tracking-tight line-clamp-2">
                Share{' '}
                <span>{props.name || props.itemType.replaceAll('_', ' ')}</span>
              </Dialog.Title>
              <Dialog.Description class="sr-only">
                Choose who can access this item or send someone a link.
              </Dialog.Description>
            </div>
          </CommandMenuShell.Header>
          <CommandMenuShell.Body scroll class="py-4">
            <section>
              <div>
                <Show when={!canForward()}>
                  <p class="px-4 py-3 text-sm text-ink-muted">
                    {RESTRICTED_SHARE_DESCRIPTIONS[props.itemType]}
                  </p>
                </Show>
                <Show when={canForward()}>
                  <ForwardToChannel
                    compact
                    {...forwardTarget(
                      props.blockAlias,
                      props.id,
                      setChannelPermissions
                    )}
                    editPermissionEnabled={editPermissionEnabled()}
                    submitPermissionInfo={{
                      setChannelPermissions: (id, accessLevel) =>
                        setChannelPermissions(id, accessLevel, true),
                      userPermissions: userPermissions(),
                      channelSharePermissions: recipients(),
                    }}
                    onSubmit={() => props.onOpenChange(false)}
                    refetch={refetch}
                    name={props.name}
                    hideAccessLevelSelector={props.itemType === 'email'}
                    initialAccessLevel={
                      props.itemType === 'email' ? 'view' : null
                    }
                    allowedAccessLevels={shareLevelsFor(props.itemType)}
                  />
                </Show>
              </div>
            </section>

            {/* Link and team access */}
            <Show
              when={
                props.linkSharing ||
                (userPermissions() === Permissions.OWNER &&
                  !isLinkSharingDisabledForItem(props.itemType))
              }
            >
              <section>
                <div>
                  <Show
                    when={props.linkSharing}
                    fallback={
                      <LinkSharingControls
                        hideCopyLink
                        editPermissionEnabled={editPermissionEnabled()}
                        linkShare={linkShare()}
                        linkShareAccessLevel={linkShareAccessLevel()}
                        hasExplicitShares={
                          (recipients()?.length ?? 0) > 0 ||
                          !!props.hasDirectShares
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
                </div>
              </section>
            </Show>
            <Show
              when={teamShareOnOwnCard(props.itemType, teamShareControls())}
            >
              {(teamShare) => (
                <section>
                  <div>
                    <div class="p-4 text-sm text-ink">
                      <TeamAccessSection teamShare={teamShare()} />
                    </div>
                  </div>
                </section>
              )}
            </Show>
            {/* Existing access */}
            <Show when={(recipients()?.length ?? 0) > 0 || !!props.owner}>
              <section class="pb-4">
                <div class="px-6 pt-2">
                  <span class="text-sm font-medium">
                    <Show when={!ownerOnlyRoster()} fallback="Owner">
                      Who has access
                    </Show>
                  </span>
                </div>
                <div class="text-ink">
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
                      <div class="grid gap-4 text-ink text-sm select-none p-6 pt-4">
                        <Show when={props.owner}>
                          <div class="flex justify-between">
                            <div class="flex items-center gap-2 overflow-hidden font-medium">
                              <OwnerLabel ownerId={props.owner} />
                            </div>
                            <div class="flex items-center">
                              <div class="font-medium text-ink-muted text-xs">
                                Owner
                              </div>
                            </div>
                          </div>
                        </Show>
                        <Dynamic component={props.people} />
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
                                      channelNameMap().get(recipient.channel_id)
                                        ?.type === 'direct_message'
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
                                      channelNameMap().get(recipient.channel_id)
                                        ?.type !== 'direct_message'
                                    }
                                    fallback={
                                      channelNameMap().get(recipient.channel_id)
                                        ?.name || 'Conversation'
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
                                    props.itemType
                                  )}
                                  disabled={
                                    userPermissions() !== Permissions.OWNER
                                  }
                                  permissions={recipient.access_level}
                                  setPermissions={(accessLevel) => {
                                    if (accessLevel === null) {
                                      removeChannelAccess(recipient.channel_id);
                                    } else if (
                                      accessLevel !== recipient.access_level
                                    ) {
                                      setChannelPermissions(
                                        recipient.channel_id,
                                        accessLevel
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
                </div>
              </section>
            </Show>
          </CommandMenuShell.Body>
          <CommandMenuShell.Footer class="justify-between gap-3 px-5 py-3 border-edge-frame bg-ink/3">
            <Button
              variant="outline"
              class="rounded-full px-4 py-2"
              onClick={copyLink}
            >
              <IconLink class="size-4" />
              Copy link
            </Button>
            <Button
              variant="cta"
              class="rounded-full px-5 py-2"
              onClick={() => props.onOpenChange(false)}
            >
              Done
            </Button>
          </CommandMenuShell.Footer>
          <Button
            variant="ghost"
            size="icon-sm"
            class="absolute right-4 top-4"
            label="Close sharing"
            onClick={() => props.onOpenChange(false)}
          >
            <IconX class="size-4" />
          </Button>
        </CommandMenuShell>
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
  textOnly?: boolean;
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

  return (
    <div class="flex items-center gap-1">
      <Tooltip
        label={
          shareStatus()?.tooltip ??
          (blockType() === 'agent'
            ? 'Share agent session'
            : blockType() === 'initiative'
              ? 'Share project'
              : inBlock
                ? 'This item has been shared with you.'
                : `Share ${blockType()}`)
        }
      >
        <HeaderActionButton
          label="Share"
          textOnly
          icon={<IconShared />}
          onClick={() => {
            if (!isAuthenticated()) {
              openLoginModal();
            } else {
              analytics.track('share_menu_open', { blockType: blockType() });
              props.onClick();
            }
          }}
        />
      </Tooltip>

      <Show when={!props.textOnly}>
        <CopyButton
          variant="ghost"
          tooltip="Copy Share Link"
          size="icon-md"
          onClick={ShareLinkAction().action}
        >
          <Dynamic component={ShareLinkAction().icon} class="size-3.5!" />
        </CopyButton>
      </Show>
    </div>
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
    optionsList.push({ value: 'view', label: accessLevelText('view') });

    // Add comment option if applicable
    if (blockName !== 'md' || ENABLE_MARKDOWN_COMMENTS) {
      optionsList.push({ value: 'comment', label: accessLevelText('comment') });
    }

    // Add edit option if enabled
    if (editPermissionEnabled()) {
      optionsList.push({ value: 'edit', label: accessLevelText('edit') });
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
    return accessLevelText(value as AccessLevel);
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
        variant="outline"
        disabled={props.disabled}
        class={cn(
          'shrink-0 flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm',
          props.noBorder && 'border-0'
        )}
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
                      <CheckIcon class="size-3.5 text-ink" />
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
                  <CheckIcon class="size-3.5 text-ink" />
                </Dropdown.ItemIndicator>
              </Dropdown.RadioItem>
            </Dropdown.Group>
          </Show>
        </Dropdown.RadioGroup>
      </Dropdown.Content>
    </Dropdown>
  );
}
