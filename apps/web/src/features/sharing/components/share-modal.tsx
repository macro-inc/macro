import { useChannelParticipants } from '@channel/use-channel-participants';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { Permissions } from '@core/component/SharePermissions';
import { type TabItem, Tabs } from '@core/component/Tabs';
import {
  getLinkShareScope,
  getLinkShareScopeCopy,
  getShareItemNoun,
  getShareStatus,
  getTeamShareScope,
  getTeamShareScopeCopy,
  LINK_SHARE_SCOPE_OPTIONS,
  type LinkShareScope,
  type ShareItemType,
  type TeamShareScope,
} from '@core/component/TopBar/linkShare';
import { UserIcon } from '@core/component/UserIcon';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { Dialog } from '@kobalte/core/dialog';
import ChevronDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import CopyIcon from '@phosphor/copy.svg';
import UserCircle from '@phosphor/user-circle.svg';
import UsersIcon from '@phosphor/users.svg';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { LinkShare } from '@service-storage/generated/schemas/linkShare';
import type { SharePermissionV2ChannelSharePermissions } from '@service-storage/generated/schemas/sharePermissionV2ChannelSharePermissions';
import { Button, cn, Dropdown, Panel, SegmentedControl, Tooltip } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { ShareOptions } from './share-options';

const isLinkSharingDisabledForItem = (itemType: ShareItemType) =>
  itemType === 'email' || itemType === 'project';

export function getShareDrawerRecipientInput(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-share-drawer-recipient] input'
  );
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
  linkShare: LinkShare | null | undefined;
  linkShareAccessLevel: AccessLevel | null | undefined;
  hasExplicitShares: boolean;
  setLinkShareScope: (scope: LinkShareScope) => void;
  setLinkShareAccessLevel: (accessLevel: AccessLevel | null) => void;
  copyLink: () => void;
  teamShare?: TeamShareControls;
}

/** Owner-only explicit team sharing, present only for entity types that support it. */
export interface TeamShareControls {
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
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-col gap-1">
        <span class="font-medium">Team access</span>
        <p class="text-sm text-ink-muted">
          Share this {props.teamShare.itemNoun} directly with the owner's team.
        </p>
      </div>
      <Dropdown>
        <Dropdown.Trigger
          variant="outline"
          aria-label="Team access"
          class="min-w-16.75 py-1 pl-2 pr-1 rounded-md flex items-center gap-1"
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
  const shareStatus = () =>
    getShareStatus(
      props.linkShare,
      props.hasExplicitShares,
      props.teamShare?.accessLevel
    );

  return (
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
        <SegmentedControl
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
              permissions={props.linkShareAccessLevel ?? 'view'}
              hideNoAccess={true}
              setPermissions={props.setLinkShareAccessLevel}
            />
          </div>
          <Button variant="outline" onClick={props.copyLink}>
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
  );
}

export type ShareForwardControls = {
  onSubmit(): void;
  onCancel(): void;
  ref?: (handle: {
    handleSubmit(): void;
    getSelectedOptions(): unknown[];
  }) => void;
};

export interface ShareModalProps {
  canForward: boolean;
  isSharePermOpen: boolean;
  setIsSharePermOpen(value: boolean): void;
  icon: JSX.Element;
  name: string;
  itemType: ShareItemType;
  owner?: string;
  userPermissions: Permissions;
  recipients: SharePermissionV2ChannelSharePermissions | undefined;
  channelNameMap: ReadonlyMap<string, { name: string; type?: string }>;
  formattedOwner: string;
  linkShare: LinkShare | null | undefined;
  linkShareAccessLevel: AccessLevel | null | undefined;
  teamShare?: TeamShareControls;
  navigateToChannel(channelId: string): void;
  removeChannelAccess(channelId: string): void;
  setChannelPermissions(
    channelId: string,
    accessLevel: AccessLevel,
    hideSuccessToast?: boolean
  ): void;
  setLinkShareScope(scope: LinkShareScope): void;
  setLinkShareAccessLevel(accessLevel: AccessLevel | null): void;
  copyLink(): void;
  forward(controls: ShareForwardControls): JSX.Element;
  forwardUnavailableDescription: string;
  /** Direct collaborators, independent of channel grants and assignee properties. */
  people?: JSX.Element;
  hasCollaborators?: boolean;
}

function MobileShareDrawer(props: ShareModalProps) {
  const [activeTab, setActiveTab] = createSignal('share');

  const wrappedSetOpen = (open: boolean) => {
    props.setIsSharePermOpen(open);
    if (!open) {
      setActiveTab('share');
    }
  };

  const mobileTabs = createMemo((): TabItem[] => {
    const tabs: TabItem[] = [{ value: 'share', label: 'Share' }];
    if ((props.recipients?.length ?? 0) > 0 || props.owner)
      tabs.push({ value: 'people', label: 'People' });
    if (
      props.userPermissions === Permissions.OWNER &&
      !isLinkSharingDisabledForItem(props.itemType)
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
      open={props.isSharePermOpen}
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
              {props.icon}
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
                {props.forwardUnavailableDescription}
              </p>
            </Show>
            <Show when={props.canForward}>
              {props.forward({
                ref: setForwardRef,
                onSubmit: () => props.setIsSharePermOpen(false),
                onCancel: () => props.setIsSharePermOpen(false),
              })}
            </Show>
            <Show when={!props.canForward}>
              <div class="px-4 py-3">
                <Button variant="outline" onClick={props.copyLink}>
                  <CopyIcon class="size-4" />
                  <span>Copy Link</span>
                </Button>
              </div>
            </Show>
          </div>
          <Show when={effectiveActiveTab() === 'people'}>
            <div class="grid gap-3 text-ink text-sm select-none py-3 px-4">
              <Show when={props.owner}>
                <div class="flex justify-between">
                  <div class="flex items-center gap-2 overflow-hidden">
                    <UserIcon isDeleted={false} id={props.owner!} size="sm" />
                    <div class="font-medium truncate">
                      {props.formattedOwner}
                    </div>
                  </div>
                  <div class="flex items-center">
                    <div class="font-medium text-ink-muted text-xs">Owner</div>
                  </div>
                </div>
              </Show>
              {props.people}
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
                              ?.name || 'Unavailable channel'
                          }
                        >
                          <GroupChannelLabel
                            channelId={recipient.channel_id}
                            fallbackName={
                              props.channelNameMap.get(recipient.channel_id)
                                ?.name || 'Unavailable channel'
                            }
                          />
                        </Show>
                      </div>
                    </div>
                    <div class="flex items-center">
                      <ShareOptions
                        permissions={recipient.access_level}
                        disabled={props.userPermissions !== Permissions.OWNER}
                        label={`Access for ${props.channelNameMap.get(recipient.channel_id)?.name ?? 'Unavailable channel'}`}
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
            <LinkSharingControls
              linkShare={props.linkShare}
              linkShareAccessLevel={props.linkShareAccessLevel}
              hasExplicitShares={
                props.hasCollaborators || (props.recipients?.length ?? 0) > 0
              }
              setLinkShareScope={props.setLinkShareScope}
              setLinkShareAccessLevel={props.setLinkShareAccessLevel}
              copyLink={props.copyLink}
              teamShare={props.teamShare}
            />
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
  const [recipientScrollRef, setRecipientScrollRef] =
    createSignal<HTMLElement>();
  return (
    <Show when={!isMobile()} fallback={<MobileShareDrawer {...props} />}>
      <Dialog
        onOpenChange={props.setIsSharePermOpen}
        open={props.isSharePermOpen}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="z-modal fixed inset-0 scrim-glass" />
          <div class="z-modal fixed inset-0">
            <Dialog.Content
              class="max-w-[calc(100vw-16px)] mt-20 sm:mt-40 mx-auto overflow-y-auto scrollbar-hidden portal-scope isolate flex flex-col gap-2 *:max-h-[75vh]"
              style={{ width: '800px' }}
            >
              {/* Card 1: Share form — gradient border */}
              <Panel depth={2} class="rounded-xl bg-dialog">
                <Panel.Header class="px-4">
                  <Dialog.Title class="flex items-center gap-1.5 min-w-0 overflow-hidden whitespace-nowrap w-full text-sm font-medium">
                    <span class="shrink-0">Share:</span>
                    {props.icon}
                    <span class="truncate">{props.name}</span>
                  </Dialog.Title>
                </Panel.Header>
                <Panel.Body>
                  <Show when={!props.canForward}>
                    <p class="px-4 py-3 text-sm text-ink-muted">
                      {props.forwardUnavailableDescription}
                    </p>
                  </Show>
                  <Show when={props.canForward}>
                    {props.forward({
                      onSubmit: () => props.setIsSharePermOpen(false),
                      onCancel: () => props.setIsSharePermOpen(false),
                    })}
                  </Show>
                  <Show when={!props.canForward}>
                    <div class="flex justify-end px-4 py-3">
                      <Button variant="outline" onClick={props.copyLink}>
                        <CopyIcon class="size-4" />
                        <span>Copy Link</span>
                      </Button>
                    </div>
                  </Show>
                </Panel.Body>
              </Panel>

              {/* Card 2: Recipients — plain border */}
              <Show when={(props.recipients?.length ?? 0) > 0 || !!props.owner}>
                <Panel depth={2} class="rounded-xl bg-dialog">
                  <Panel.Header class="px-4">
                    <span class="text-sm font-medium">
                      People with access to this{' '}
                      {getShareItemNoun(props.itemType)}
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
                          <Show when={props.owner}>
                            <div class="flex justify-between">
                              <div class="flex items-center gap-2 overflow-hidden">
                                <UserIcon
                                  isDeleted={false}
                                  id={props.owner!}
                                  size="sm"
                                />
                                <div class="font-medium truncate">
                                  {props.formattedOwner}
                                </div>
                              </div>
                              <div class="flex items-center">
                                <div class="font-medium text-ink-muted text-xs">
                                  Owner
                                </div>
                              </div>
                            </div>
                          </Show>
                          {props.people}
                          <For each={props.recipients || []}>
                            {(recipient) => (
                              <div class="flex justify-between">
                                <div
                                  class="flex items-center gap-2 overflow-hidden"
                                  onClick={() =>
                                    props.navigateToChannel(
                                      recipient.channel_id
                                    )
                                  }
                                >
                                  <Switch
                                    fallback={
                                      <UsersIcon class="shrink-0 size-4" />
                                    }
                                  >
                                    <Match
                                      when={
                                        props.channelNameMap.get(
                                          recipient.channel_id
                                        )?.type === 'direct_message'
                                      }
                                    >
                                      <DmRecipientIcon
                                        channelId={recipient.channel_id}
                                      />
                                    </Match>
                                    <Match
                                      when={props.channelNameMap.get(
                                        recipient.channel_id
                                      )}
                                    >
                                      <UsersIcon class="shrink-0 size-4" />
                                    </Match>
                                  </Switch>
                                  <div class="font-medium truncate">
                                    <Show
                                      when={
                                        props.channelNameMap.get(
                                          recipient.channel_id
                                        )?.type !== 'direct_message'
                                      }
                                      fallback={
                                        props.channelNameMap.get(
                                          recipient.channel_id
                                        )?.name || 'Unavailable channel'
                                      }
                                    >
                                      <GroupChannelLabel
                                        channelId={recipient.channel_id}
                                        fallbackName={
                                          props.channelNameMap.get(
                                            recipient.channel_id
                                          )?.name || 'Unavailable channel'
                                        }
                                      />
                                    </Show>
                                  </div>
                                </div>
                                <div class="flex items-center">
                                  <ShareOptions
                                    permissions={recipient.access_level}
                                    disabled={
                                      props.userPermissions !==
                                      Permissions.OWNER
                                    }
                                    label={`Access for ${props.channelNameMap.get(recipient.channel_id)?.name ?? 'Unavailable channel'}`}
                                    setPermissions={(accessLevel) => {
                                      if (accessLevel === null) {
                                        props.removeChannelAccess(
                                          recipient.channel_id
                                        );
                                      } else if (
                                        accessLevel !== recipient.access_level
                                      ) {
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
                      </div>
                    </div>
                  </Panel.Body>
                </Panel>
              </Show>

              {/* Card 3: Link sharing — plain border */}
              <Show
                when={
                  props.userPermissions === Permissions.OWNER &&
                  !isLinkSharingDisabledForItem(props.itemType)
                }
              >
                <Panel depth={2} class="rounded-xl bg-dialog">
                  <Panel.Body>
                    <LinkSharingControls
                      linkShare={props.linkShare}
                      linkShareAccessLevel={props.linkShareAccessLevel}
                      hasExplicitShares={
                        props.hasCollaborators ||
                        (props.recipients?.length ?? 0) > 0
                      }
                      setLinkShareScope={props.setLinkShareScope}
                      setLinkShareAccessLevel={props.setLinkShareAccessLevel}
                      copyLink={props.copyLink}
                      teamShare={props.teamShare}
                    />
                  </Panel.Body>
                </Panel>
              </Show>
              <Show when={teamShareOnOwnCard(props.itemType, props.teamShare)}>
                {(teamShare) => (
                  <Panel depth={2} class="rounded-xl bg-dialog">
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
