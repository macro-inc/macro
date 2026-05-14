import { useAnalytics } from '@app/component/analytics-context';
import { MobileDrawer } from '@app/component/mobile/MobileDrawer';
import { useChannelParticipants } from '@channel/use-channel-participants';
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
} from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { DropdownMenuContent } from '@core/component/Menu';
import { type TabItem, Tabs } from '@core/component/Tabs';
import { UserIcon } from '@core/component/UserIcon';
import { ENABLE_MARKDOWN_COMMENTS } from '@core/constant/featureFlags';
import { useReferralCode, useUserId } from '@core/context/user';
import clickOutside from '@core/directive/clickOutside';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import {
  blockEditPermissionEnabledSignal,
  blockMetadataSignal,
} from '@core/signal/load';
import {
  useGetPermissions,
  useIsDocumentOwner,
} from '@core/signal/permissions';
import { idToEmail } from '@core/user';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import {
  isErr,
  isOk,
  type MaybeError,
  type MaybeResult,
} from '@core/util/maybeResult';
import { buildSimpleEntityUrl } from '@core/util/url';
import CheckIcon from '@icon/bold/check-bold.svg';
import IconX from '@icon/bold/x-bold.svg';
import ChevronDownIcon from '@icon/regular/caret-down.svg';
import IconLink from '@icon/regular/link.svg';
import IconShared from '@icon/regular/share.svg';
import { Dialog } from '@kobalte/core/dialog';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import IconComment from '@macro-icons/wide/comment.svg';
import WideCopy from '@macro-icons/wide/copy.svg';
import IconEdit from '@macro-icons/wide/edit.svg';
import IconEye from '@macro-icons/wide/eye.svg';
import UserCircle from '@macro-icons/wide/user-circle.svg';
import WideUsers from '@macro-icons/wide/users.svg';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { commsServiceClient } from '@service-comms/client';
import {
  blockNameToItemType,
  type ItemType,
  storageServiceClient,
} from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { SharePermissionV2ChannelSharePermissions } from '@service-storage/generated/schemas/sharePermissionV2ChannelSharePermissions';
import { createCallback } from '@solid-primitives/rootless';
import { useNavigate } from '@solidjs/router';
import { Button, ButtonGroup, cn, Panel, ToggleSwitch, Tooltip } from '@ui';
import {
  type Accessor,
  createContext,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Suspense,
  Switch,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import { CustomScrollbar } from '../CustomScrollbar';
import { ForwardToChannel } from '../ForwardToChannel';
import { Permissions } from '../SharePermissions';
import { toast } from '../Toast/Toast';
import { ScrollIndicators } from '../VerticalScrollIndicators';
import { openLoginModal } from './LoginButton';

false && clickOutside;

interface IShareDialogContext {
  isOpen: Accessor<boolean>;
  open: () => void;
  close: () => void;
}

export const ShareDialogContext = createContext<IShareDialogContext>();

export function useShareDialogContext() {
  const ctx = useContext(ShareDialogContext);
  if (!ctx)
    throw new Error(
      'useShareDialogContext must be used within a ShareDialogContext.Provider'
    );
  return ctx;
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
    if (itemType === 'chat') {
      return cognitionApiServiceClient.getChatPermissions({ id });
    } else if (itemType === 'document') {
      return storageServiceClient.getDocumentPermissions({ document_id: id });
    } else if (itemType === 'project') {
      if (id === 'trash') {
        return;
      }
      return storageServiceClient.projects.getPermissions({ id });
    }
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

export function getShareDrawerRecipientInput(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-share-drawer-recipient] input'
  );
}

interface ShareModalProps {
  setIsSharePermOpen: (value: boolean) => void;
  userPermissions: Permissions;
  isSharePermOpen: boolean;
  blockAlias: BlockName | BlockAlias;
  itemType: ItemType;
  owner?: string;
  name: string;
  id: string;
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

interface MobileShareDrawerProps {
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
  blockAlias: BlockName | BlockAlias;
  name: string;
  id: string;
  itemType: ItemType;
  owner?: string;
  userPermissions: Permissions;
  recipients: SharePermissionV2ChannelSharePermissions | undefined;
  channelNameMap: Map<string, { name: string; type: string }>;
  formattedOwner: string;
  publicAccessLevel: AccessLevel | null | undefined;
  refetch: () => void;
  navigateToChannel: (channelId: string) => void;
  removeChannelAccess: (channelId: string) => void;
  setChannelPermissions: (
    channelId: string,
    accessLevel: AccessLevel,
    hideSuccessToast?: boolean
  ) => void;
  setPublicPermissions: (accessLevel: AccessLevel | null) => void;
  copyPublicLink: () => void;
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
    if ((props.recipients?.length ?? 0) > 0 || !!props.owner)
      tabs.push({ value: 'people', label: 'People' });
    if (
      props.userPermissions === Permissions.OWNER &&
      props.itemType !== 'email'
    )
      tabs.push({ value: 'link', label: 'Link' });
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
      initialFocusEl={getShareDrawerRecipientInput() ?? undefined}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
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
            <Show when={effectiveActiveTab() === 'share'}>
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
            <ForwardToChannel
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
              blockId={props.id}
              blockName={props.blockAlias}
            />
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
              <For each={props.recipients || []}>
                {(recipient) => (
                  <div class="flex justify-between">
                    <div
                      class="flex items-center gap-2 overflow-hidden"
                      onClick={() =>
                        props.navigateToChannel(recipient.channel_id)
                      }
                    >
                      <Switch fallback={<WideUsers class="shrink-0 size-4" />}>
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
                          <WideUsers class="shrink-0 size-4" />
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
                              ?.name || recipient.channel_id
                          }
                        >
                          <GroupChannelLabel
                            channelId={recipient.channel_id}
                            fallbackName={
                              props.channelNameMap.get(recipient.channel_id)
                                ?.name || recipient.channel_id
                            }
                          />
                        </Show>
                      </div>
                    </div>
                    <div class="flex items-center">
                      <ShareOptions
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
            <div class="text-ink flex flex-col">
              <div
                class={cn(
                  'flex flex-col gap-3 px-3 py-2 text-sm font-medium',
                  props.publicAccessLevel != null &&
                    'border-b border-edge-muted'
                )}
              >
                <div class="flex items-center gap-2">
                  Public link
                  <div
                    class={cn(
                      'px-2 rounded-xl border py-0.5 flex justify-center items-center',
                      props.publicAccessLevel != null
                        ? 'border-accent/30 bg-accent/10'
                        : 'border-edge-muted bg-edge-muted'
                    )}
                  >
                    <span
                      class={cn(
                        'text-xs font-medium whitespace-nowrap',
                        props.publicAccessLevel != null
                          ? 'text-accent'
                          : 'text-ink-extra-muted'
                      )}
                    >
                      {props.publicAccessLevel != null ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </div>
                </div>
                <ToggleSwitch
                  onChange={(checked) =>
                    props.setPublicPermissions(checked ? 'view' : null)
                  }
                  checked={props.publicAccessLevel != null}
                  labelClass="whitespace-nowrap"
                  label="Enable public link"
                />
              </div>
              <Show when={props.publicAccessLevel != null}>
                <div class="flex flex-col gap-3 px-3 py-2">
                  <span class="text-sm text-ink-muted flex items-center">
                    <span class="px-2">Anyone with the link can</span>
                    <ShareOptions
                      permissions={props.publicAccessLevel ?? null}
                      hideNoAccess={true}
                      setPermissions={props.setPublicPermissions}
                    />
                  </span>
                  <Button
                    variant="base"
                    size="sm"
                    class="flex items-center gap-1 rounded-xs px-2 py-1"
                    onClick={props.copyPublicLink}
                  >
                    <WideCopy class="size-4" />
                    <span>Copy Link</span>
                  </Button>
                </div>
              </Show>
            </div>
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

export function ShareModal(props: ShareModalProps) {
  const navigate = useNavigate();
  const analytics = useAnalytics();
  const isBlockContext = isInBlock();
  const [fallbackPermissionsResource, { refetch: refetchFallback }] =
    createResource(
      () => {
        if (isBlockContext || !props.id) return;
        return { id: props.id, itemType: props.itemType };
      },
      async (source) => {
        if (!source) return;
        const { id, itemType } = source;
        if (itemType === 'chat') {
          return cognitionApiServiceClient.getChatPermissions({ id });
        } else if (itemType === 'document') {
          return storageServiceClient.getDocumentPermissions({
            document_id: id,
          });
        } else if (itemType === 'project') {
          if (id === 'trash') {
            return;
          }
          return storageServiceClient.projects.getPermissions({ id });
        }
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

  const [recipientScrollRef, setRecipientScrollRef] =
    createSignal<HTMLElement>();

  const referralCode = useReferralCode();

  const copyPublicLink = createCallback(() => {
    const params: Record<string, string> = {};
    const code = referralCode();
    if (code) {
      params.referral_code = code;
    }
    const url = buildSimpleEntityUrl(
      {
        type: props.blockAlias,
        id: props.id,
      },
      params
    );
    navigator.clipboard.writeText(url);
    toast.success(
      'Link copied to clipboard.',
      'Sending this link in a Macro message will automatically update permissions to include recipients.'
    );
  });

  const [channelNamesResource] = createResource(
    () => {
      const result = permissionsResource.latest;
      if (!result || isErr(result)) {
        return;
      }
      const [, sharePermission] = result;
      if (!sharePermission?.channelSharePermissions?.length) {
        return;
      }
      const channel_ids = sharePermission.channelSharePermissions.map(
        ({ channel_id }) => channel_id
      );
      return { channel_ids };
    },
    commsServiceClient.getBatchChannelPreviews,
    { initialValue: undefined }
  );

  // Create a map of channel IDs to channel names
  const channelNameMap = createMemo(() => {
    const result = channelNamesResource.latest;
    if (!result || isErr(result)) {
      return new Map();
    }

    const [, data] = result;
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
    const maybeResult = permissionsResource.latest;
    if (!maybeResult || isErr(maybeResult)) return;

    const [, sharePermission] = maybeResult;
    return sharePermission.channelSharePermissions;
  });

  // Function to navigate to a channel
  const navigateToChannel = createCallback((channelId: string) => {
    navigate(`/channel/${channelId}`);
    props.setIsSharePermOpen(false); // Close the dialog after navigation
  });

  const removeChannelAccess = createCallback(async (channelId: string) => {
    if (props.itemType === 'chat') {
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
      if (!isErr(result)) {
        refetch();
        toast.success(
          'Removed channel access',
          'Channel no longer has access to this chat'
        );
      } else {
        toast.alert('Failed to remove channel access', 'Please try again');
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
      if (!isErr(result)) {
        refetch();
        toast.success(
          'Removed channel access',
          'Channel no longer has access to this document'
        );
      } else {
        toast.alert('Failed to remove channel access', 'Please try again');
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
      if (!isErr(result)) {
        refetch();
        toast.success('Removed folder access');
      } else {
        toast.alert('Failed to remove folder access', 'Please try again');
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
      if (props.userPermissions !== Permissions.OWNER) return;

      let result: MaybeResult<any, any> | MaybeError<any> | null = null;
      if (props.itemType === 'chat') {
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

      if (result && isOk(result)) {
        refetch();
        if (!hideSuccessToast) {
          toast.success(
            'Changed channel access level',
            accessLevelText(accessLevel)
          );
        }
      } else {
        toast.alert('Failed to change channel access', 'Please try again');
        console.error(result);
      }
    }
  );

  const publicAccessLevel = createMemo(() => {
    const currentPermissions = permissionsResource.latest;
    if (!currentPermissions || isErr(currentPermissions)) {
      return;
    }

    const [, sharePermission] = currentPermissions;
    return sharePermission.publicAccessLevel;
  });

  const setPublicPermissions = createCallback(
    async (accessLevel: AccessLevel | null) => {
      if (props.itemType === 'chat') {
        const result = await cognitionApiServiceClient.updateChatPermissions({
          sharePermission: {
            publicAccessLevel: accessLevel,
            isPublic: accessLevel != null,
          },
          chat_id: props.id,
        });
        if (!isErr(result)) {
          refetch();

          if (accessLevel === null) {
            toast.success(
              'Made chat private',
              'Only shared users can access this chat'
            );
          } else {
            toast.success(
              'Updated public link sharing',
              `Anyone with the link can ${accessLevel} this chat`
            );

            analytics.track('share_entity', {
              entityType: 'chat',
              accessLevel,
              isPublic: true,
            });
          }
        } else {
          toast.alert('Failed to change chat access', 'Please try again');
          console.error(result);
        }
      } else if (props.itemType === 'document') {
        const result = await storageServiceClient.editDocument({
          sharePermission: {
            publicAccessLevel: accessLevel,
            isPublic: accessLevel != null,
          },
          documentId: props.id,
        });
        if (!isErr(result)) {
          refetch();
          if (accessLevel === null) {
            toast.success(
              'Made document private',
              'Only shared users can access this document'
            );
          } else {
            toast.success(
              'Updated public link sharing',
              `Anyone with the link can ${accessLevel} this document`
            );

            analytics.track('share_entity', {
              entityType: 'document',
              accessLevel,
              isPublic: true,
            });
          }
        } else {
          toast.alert('Failed to change document access', 'Please try again');
          console.error(result);
        }
      } else if (props.itemType === 'project') {
        const result = await storageServiceClient.projects.edit({
          sharePermission: {
            publicAccessLevel: accessLevel,
            isPublic: accessLevel != null,
          },
          id: props.id,
        });
        if (!isErr(result)) {
          refetch();
          if (accessLevel === null) {
            toast.success(
              'Made folder private',
              'Only shared users can access this folder'
            );
          } else {
            toast.success(
              'Updated public link sharing',
              `Anyone with the link can ${accessLevel} this folder`
            );

            analytics.track('share_entity', {
              entityType: 'project',
              accessLevel,
              isPublic: true,
            });
          }
        } else {
          toast.alert('Failed to change folder access', 'Please try again');
          console.error(result);
        }
      }
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
    <Show
      when={!isMobile()}
      fallback={
        <MobileShareDrawer
          isOpen={props.isSharePermOpen}
          setIsOpen={props.setIsSharePermOpen}
          blockAlias={props.blockAlias}
          name={props.name}
          id={props.id}
          itemType={props.itemType}
          owner={props.owner}
          userPermissions={props.userPermissions}
          recipients={recipients()}
          channelNameMap={channelNameMap()}
          formattedOwner={formattedOwner()}
          publicAccessLevel={publicAccessLevel()}
          refetch={refetch}
          navigateToChannel={navigateToChannel}
          removeChannelAccess={removeChannelAccess}
          setChannelPermissions={setChannelPermissions}
          setPublicPermissions={setPublicPermissions}
          copyPublicLink={copyPublicLink}
        />
      }
    >
      <Dialog
        onOpenChange={props.setIsSharePermOpen}
        open={props.isSharePermOpen}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="z-modal fixed inset-0 bg-modal-overlay pattern-edge-muted pattern-diagonal-4" />
          <div class="z-modal fixed inset-0">
            <Dialog.Content
              class="max-w-[calc(100vw-16px)] mt-20 sm:mt-40 mx-auto overflow-y-auto scrollbar-hidden portal-scope flex flex-col gap-2 *:max-h-[75vh]"
              style={{ width: '800px' }}
            >
              {/* Card 1: Share form — gradient border */}
              <Panel active>
                <Panel.Header class="px-3">
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
                  <ForwardToChannel
                    submitPermissionInfo={{
                      setChannelPermissions: (id, accessLevel) =>
                        setChannelPermissions(id, accessLevel, true),
                      userPermissions: props.userPermissions,
                      channelSharePermissions: recipients(),
                    }}
                    onSubmit={() => props.setIsSharePermOpen(false)}
                    onCancel={() => props.setIsSharePermOpen(false)}
                    refetch={refetch}
                    name={props.name}
                    hideAccessLevelSelector={props.itemType === 'email'}
                    initialAccessLevel={
                      props.itemType === 'email' ? 'view' : null
                    }
                    blockId={props.id}
                    blockName={props.blockAlias}
                  />
                </Panel.Body>
              </Panel>

              {/* Card 2: Recipients — plain border */}
              <Show when={(recipients()?.length ?? 0) > 0 || !!props.owner}>
                <Panel>
                  <Panel.Header class="px-3">
                    <span class="text-sm font-medium">
                      People with access to this{' '}
                      {props.itemType === 'email'
                        ? 'email thread'
                        : props.itemType}
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
                        <div class="grid gap-3 text-ink text-sm select-none p-3">
                          <Show when={props.owner}>
                            <div class="flex justify-between">
                              <div class="flex items-center gap-2 overflow-hidden">
                                <UserIcon
                                  isDeleted={false}
                                  id={props.owner!}
                                  size="sm"
                                />
                                <div class="font-medium truncate">
                                  {formattedOwner()}
                                </div>
                              </div>
                              <div class="flex items-center">
                                <div class="font-medium text-ink-muted text-xs">
                                  Owner
                                </div>
                              </div>
                            </div>
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
                                      <WideUsers class="shrink-0 size-4" />
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
                                      <WideUsers class="shrink-0 size-4" />
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
                                        )?.name || recipient.channel_id
                                      }
                                    >
                                      <GroupChannelLabel
                                        channelId={recipient.channel_id}
                                        fallbackName={
                                          channelNameMap().get(
                                            recipient.channel_id
                                          )?.name || recipient.channel_id
                                        }
                                      />
                                    </Show>
                                  </div>
                                </div>
                                <div class="flex items-center">
                                  <ShareOptions
                                    permissions={recipient.access_level}
                                    setPermissions={(accessLevel) => {
                                      if (accessLevel === null) {
                                        removeChannelAccess(
                                          recipient.channel_id
                                        );
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
                  </Panel.Body>
                </Panel>
              </Show>

              {/* Card 3: Public link — plain border */}
              <Show
                when={
                  props.userPermissions === Permissions.OWNER &&
                  props.itemType !== 'email'
                }
              >
                <Panel>
                  <Panel.Header class="justify-between px-3">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-medium">Public link</span>
                      <div
                        class={cn(
                          'px-2 rounded-xl border py-0.5 flex justify-center items-center',
                          publicAccessLevel() != null
                            ? 'border-accent/30 bg-accent/10'
                            : 'border-edge-muted bg-edge-muted'
                        )}
                      >
                        <span
                          class={cn(
                            'text-xs font-medium whitespace-nowrap',
                            publicAccessLevel() != null
                              ? 'text-accent'
                              : 'text-ink-extra-muted'
                          )}
                        >
                          {publicAccessLevel() != null ? 'ENABLED' : 'DISABLED'}
                        </span>
                      </div>
                    </div>
                    <ToggleSwitch
                      label="Enable public link"
                      labelClass="whitespace-nowrap"
                      checked={publicAccessLevel() != null}
                      onChange={(on) =>
                        setPublicPermissions(on ? 'view' : null)
                      }
                    />
                  </Panel.Header>
                  <Show when={publicAccessLevel() != null}>
                    <Panel.Body class="text-ink">
                      <div class="flex items-center p-3 justify-between">
                        <Button
                          variant="base"
                          size="sm"
                          class="flex items-center gap-1 rounded-xs px-2 py-1"
                          onClick={copyPublicLink}
                        >
                          <WideCopy class="size-4" />
                          <span class="hidden sm:inline">Copy Link</span>
                        </Button>
                        <span class="text-sm text-ink-muted flex items-center">
                          <span class="px-2 hidden sm:inline">
                            Anyone with the link can
                          </span>
                          <span class="px-2 sm:hidden">Permissions:</span>
                          <ShareOptions
                            permissions={publicAccessLevel() ?? null}
                            hideNoAccess={true}
                            setPermissions={setPublicPermissions}
                          />
                        </span>
                      </div>
                    </Panel.Body>
                  </Show>
                </Panel>
              </Show>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog>
    </Show>
  );
}

export function ShareTrigger(props: { copyLink?: () => void }) {
  const shareCtx = useShareDialogContext();
  const isAuthenticated = useIsAuthenticated();
  const blockType = useBlockAliasedName();
  const blockId = useBlockId();
  const analytics = useAnalytics();

  onMount(() => {
    const blockScopeId = blockHotkeyScopeSignal.get;
    registerHotkey({
      keyDownHandler: () => {
        if (!isAuthenticated()) {
          openLoginModal();
        } else {
          analytics.track('share_menu_open', { blockType });
          shareCtx.open();
        }
        return true;
      },
      hotkeyToken: TOKENS.block.share,
      runWithInputFocused: true,
      scopeId: blockScopeId(),
      description: 'Share',
      hotkey: 'cmd+s',
    });
  });

  const referralCode = useReferralCode();

  const defaultUrl = () => {
    const params: Record<string, string> = {};
    const code = referralCode();
    if (code) {
      params.referral_code = code;
    }
    return buildSimpleEntityUrl({ id: blockId, type: blockType }, params);
  };

  const copyLink = createCallback(() => {
    if (props.copyLink) return props.copyLink();
    navigator.clipboard.writeText(defaultUrl());
    analytics.track('copy_share_link', { blockType });
    toast.success(
      'Link copied to clipboard.',
      'Sending this link in a Macro message will automatically update permissions to include recipients.'
    );
  });

  const ShareLinkAction = createMemo(() => ({
    action: (e: MouseEvent | KeyboardEvent) => {
      e.stopPropagation();
      copyLink();
    },
    icon: IconLink,
  }));

  const shareAccessLevelText = createMemo(() => {
    const maybeResult = permissionsBlockResource[0].latest;
    if (!maybeResult || isErr(maybeResult)) return '';
    const [, sharePermission] = maybeResult;
    if (sharePermission.isPublic) return 'Public';
    if (sharePermission.channelSharePermissions?.length) return 'Shared';
    return 'Just me';
  });

  const shareAccessTooltip = () =>
    match(shareAccessLevelText())
      .when(
        (level) => level === 'Public',
        () => 'Anyone with the link can access this item'
      )
      .when(
        (level) => level === 'Shared',
        () => 'Shared with specific people or channels'
      )
      .when(
        (level) => level === 'Just me',
        () => 'Only you can access this item'
      )
      .otherwise(() => 'This item has been shared with you');

  return (
    <ButtonGroup variant="base" size="sm" class="bg-surface" depth={2}>
      <Tooltip label={shareAccessTooltip()}>
        <Button
          onClick={() => {
            if (!isAuthenticated()) {
              openLoginModal();
            } else {
              analytics.track('share_menu_open', { blockType });
              shareCtx.open();
            }
          }}
          class="text-ink-muted"
        >
          <IconShared />
          Share
        </Button>
      </Tooltip>

      <ButtonGroup.Divider />

      <Button
        tooltip="Copy Share Link"
        size="icon-sm"
        onClick={ShareLinkAction().action}
        class="text-ink-muted"
      >
        <Dynamic component={ShareLinkAction().icon} class="size-3.5!" />
      </Button>
    </ButtonGroup>
  );
}

export function ShareBlockModal(props: {
  name?: string;
  userPermissions?: Permissions;
  owner?: string;
}) {
  const ctx = useShareDialogContext();
  const id = useBlockId();
  const blockAlias = useBlockAliasedName();
  const blockName = useBlockName();
  const itemType = blockNameToItemType(blockName);
  const documentName = useBlockDocumentName();
  const permissions = useGetPermissions();
  const ownerDerived = () => blockMetadataSignal()?.owner;

  if (!itemType) return null;

  return (
    <Suspense>
      <ShareModal
        isSharePermOpen={ctx.isOpen()}
        setIsSharePermOpen={(v) => (v ? ctx.open() : ctx.close())}
        id={id}
        blockAlias={blockAlias}
        itemType={itemType}
        name={props.name ?? documentName() ?? ''}
        userPermissions={props.userPermissions ?? permissions()}
        owner={props.owner ?? ownerDerived()}
      />
    </Suspense>
  );
}

const PERMISSION_ICONS = {
  comment: IconComment,
  view: IconEye,
  edit: IconEdit,
} as const;

export function ShareOptions(props: {
  setPermissions: (accessLevel: AccessLevel | null) => void;
  permissions?: AccessLevel | null;
  hideNoAccess?: boolean;
  label?: string | '';
  disabled?: boolean;
  noBorder?: boolean;
}) {
  const editPermissionEnabled = isInBlock()
    ? blockEditPermissionEnabledSignal()
    : true;
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
    if (editPermissionEnabled) {
      optionsList.push({ value: 'edit', label: accessLevelText('edit') });
    }

    // Add no access option if not hidden
    if (!props.hideNoAccess) {
      optionsList.push({ value: 'none', label: accessLevelText(null) });
    }

    return optionsList;
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
    <DropdownMenu open={isOpen()} onOpenChange={setIsOpen}>
      <DropdownMenu.Trigger
        disabled={props.disabled}
        on:keydown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
      >
        <Button
          disabled={props.disabled}
          class={`min-w-16.75 py-1 pl-2 pr-1 rounded-xs flex items-center gap-1 ${props.noBorder ? 'border-0 sm:border' : ''}`}
          variant="base"
        >
          {currentValueText()}
          <ChevronDownIcon class="size-4 text-ink-extra-muted/50" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenuContent>
          <DropdownMenu.RadioGroup
            value={currentValue()}
            onChange={handleChange}
          >
            <For each={options().filter((o) => o.value !== 'none')}>
              {(option) => {
                const Icon =
                  PERMISSION_ICONS[
                    option.value as keyof typeof PERMISSION_ICONS
                  ];
                return (
                  <DropdownMenu.RadioItem
                    value={option.value}
                    class="flex items-center gap-2 w-full py-1 px-2 text-sm font-medium rounded-xs hover:bg-hover hover-transition-bg outline-none focus:bg-active data-highlighted:bg-active"
                  >
                    <div class="size-4 shrink-0">
                      {Icon && <Icon class="size-full" />}
                    </div>
                    <div class="flex-1 truncate">{option.label}</div>
                    <Show when={currentValue() === option.value}>
                      <CheckIcon class="size-3 text-accent" />
                    </Show>
                  </DropdownMenu.RadioItem>
                );
              }}
            </For>
            <Show when={!props.hideNoAccess}>
              <div class="my-1 border-t border-edge-muted w-full" />
              <DropdownMenu.RadioItem
                value="none"
                class="flex items-center gap-2 w-full py-1 px-2 text-sm font-medium rounded-xs hover:bg-hover hover-transition-bg outline-none focus:bg-active data-highlighted:bg-active"
              >
                <div class="size-4 shrink-0">
                  <IconX class="size-full" />
                </div>
                <div class="flex-1 truncate">{accessLevelText(null)}</div>
                <Show when={currentValue() === 'none'}>
                  <CheckIcon class="size-3 text-accent" />
                </Show>
              </DropdownMenu.RadioItem>
            </Show>
          </DropdownMenu.RadioGroup>
        </DropdownMenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
