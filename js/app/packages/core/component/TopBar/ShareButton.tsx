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
import { DropdownMenuContent } from '@core/component/Menu';
import { UserIcon } from '@core/component/UserIcon';
import { ENABLE_MARKDOWN_COMMENTS } from '@core/constant/featureFlags';
import clickOutside from '@core/directive/clickOutside';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import {
  blockEditPermissionEnabledSignal,
  blockMetadataSignal,
} from '@core/signal/load';
import {
  useGetPermissions,
  useIsDocumentOwner,
} from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { idToEmail } from '@core/user';
import {
  isErr,
  isOk,
  type MaybeError,
  type MaybeResult,
} from '@core/util/maybeResult';
import { buildSimpleEntityUrl } from '@core/util/url';
import CheckIcon from '@icon/bold/check-bold.svg';
import IconLink from '@icon/regular/link.svg';
import UserCircle from '@macro-icons/wide/user-circle.svg';
import WideCopy from '@macro-icons/wide/copy.svg';
import WideUsers from '@macro-icons/wide/users.svg';
import IconX from '@icon/bold/x-bold.svg';
import IconShared from '@macro-icons/wide/share.svg';
import IconComment from '@macro-icons/wide/comment.svg';
import IconEdit from '@macro-icons/wide/edit.svg';
import IconEye from '@macro-icons/wide/eye.svg';
import { Dialog } from '@kobalte/core/dialog';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { commsServiceClient } from '@service-comms/client';
import { useReferralCode, useUserId } from '@core/context/user';
import {
  blockNameToItemType,
  type ItemType,
  storageServiceClient,
} from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { createCallback } from '@solid-primitives/rootless';
import { useNavigate } from '@solidjs/router';
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
import { match } from 'ts-pattern';
import { EntityIcon } from '@core/component/EntityIcon';
import { MiniToggleSwitch } from '@core/component/FormControls/MiniToggleSwitch';
import { ClippedPanel } from '../ClippedPanel';
import { CustomScrollbar } from '../CustomScrollbar';
import { ForwardToChannel } from '../ForwardToChannel';
import { Permissions } from '../SharePermissions';
import { toast } from '../Toast/Toast';
import { Tooltip } from '../Tooltip';
import { openLoginModal } from './LoginButton';
import { ScrollIndicators } from '../VerticalScrollIndicators';
import { useChannelParticipants } from '@channel/use-channel-participants';
import { useAnalytics } from '@app/component/analytics-context';
import { Button } from '@ui/components/Button';
import { Dynamic } from 'solid-js/web';
import ChevronDownIcon from '@icon/regular/caret-down.svg';

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
      fallback={<UserCircle class="flex-shrink-0 w-4 h-4" />}
    >
      {(id) => (
        <UserIcon id={id()} size="xs" isDeleted={false} showTooltip={false} />
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
      <Tooltip
        placement="bottom"
        tooltip={<div class="text-xs whitespace-pre">{tooltipContent()}</div>}
      >
        <span>{label()}</span>
      </Tooltip>
    </Show>
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
    <Dialog
      onOpenChange={props.setIsSharePermOpen}
      open={props.isSharePermOpen}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="z-modal fixed inset-0 bg-modal-overlay pattern-edge-muted pattern-diagonal-4 pointer-events-none" />
        <div class="z-modal fixed inset-0 flex flex-col items-center justify-center py-8">
          <Dialog.Content
            class="max-w-[calc(100vw-16px)] max-h-[calc(100vh-64px)] overflow-y-auto scrollbar-hidden mx-auto portal-scope flex flex-col gap-2"
            style={{ width: '533px' }}
          >
            {/* Card 1: Share form — gradient border */}
            <ClippedPanel active cornerRadius="4px">
              <div class="text-ink flex flex-col">
                <div class="shrink-0 flex flex-row items-center justify-between px-3 h-[40px] gap-2 border-b border-edge-muted">
                  <div class="flex-1 flex flex-row items-center gap-2 min-w-0">
                    <Dialog.Title class="flex items-center gap-1.5 min-w-0 overflow-hidden whitespace-nowrap w-full text-sm font-medium">
                      <span class="shrink-0">Share:</span>
                      <EntityIcon
                        targetType={props.blockAlias}
                        size="sm"
                        class="shrink-0"
                      />
                      <span class="truncate">{props.name}</span>
                    </Dialog.Title>
                  </div>
                </div>
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
              </div>
            </ClippedPanel>

            {/* Card 2: Recipients — plain border */}
            <Show when={(recipients()?.length ?? 0) > 0 || !!props.owner}>
              <ClippedPanel cornerRadius="4px">
                <div class="text-ink flex flex-col">
                  <div class="shrink-0 h-[40px] flex items-center px-3 border-b border-edge-muted text-sm font-medium">
                    People with access to this{' '}
                    {props.itemType === 'email'
                      ? 'email thread'
                      : props.itemType}
                  </div>
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
                      <div class="grid gap-3 text-ink text-sm select-none py-3 px-3">
                        <Show when={props.owner}>
                          <div class="flex justify-between">
                            <div class="flex items-center gap-2 overflow-hidden">
                              <UserIcon
                                isDeleted={false}
                                id={props.owner!}
                                size="xs"
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
                                class="flex items-center gap-2 overflow-hidden cursor-pointer"
                                onClick={() =>
                                  navigateToChannel(recipient.channel_id)
                                }
                              >
                                <Switch
                                  fallback={
                                    <WideUsers class="flex-shrink-0 w-4 h-4" />
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
                                    <WideUsers class="flex-shrink-0 w-4 h-4" />
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
                                        ?.name || recipient.channel_id
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
              </ClippedPanel>
            </Show>

            {/* Card 3: Public link — plain border */}
            <Show
              when={
                props.userPermissions === Permissions.OWNER &&
                props.itemType !== 'email'
              }
            >
              <ClippedPanel cornerRadius="4px">
                <div class="text-ink flex flex-col">
                  <div
                    class="h-[40px] flex items-center justify-between px-3 text-sm font-medium"
                    classList={{
                      'border-b border-edge-muted': publicAccessLevel() != null,
                    }}
                  >
                    <div class="flex items-center gap-2">
                      Public link
                      <div
                        class="px-2 rounded-xl border-1 py-0.5 flex justify-center items-center"
                        classList={{
                          'border-accent/30 bg-accent/10':
                            publicAccessLevel() != null,
                          'border-edge-muted bg-edge-muted/20':
                            publicAccessLevel() == null,
                        }}
                      >
                        <span
                          class="text-xs font-medium whitespace-nowrap"
                          classList={{
                            'text-accent-ink': publicAccessLevel() != null,
                            'text-ink-extra-muted': publicAccessLevel() == null,
                          }}
                        >
                          {publicAccessLevel() != null ? 'ENABLED' : 'DISABLED'}
                        </span>
                      </div>
                    </div>
                    <MiniToggleSwitch
                      size="Base"
                      label="Enable public link"
                      checked={publicAccessLevel() != null}
                      onChange={(on) =>
                        setPublicPermissions(on ? 'view' : null)
                      }
                    />
                  </div>
                  <Show when={publicAccessLevel() != null}>
                    <div class="flex items-center p-3 justify-between">
                      <Button
                        variant="secondary"
                        size="sm"
                        class="flex items-center gap-1 rounded-xs px-2"
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
                  </Show>
                </div>
              </ClippedPanel>
            </Show>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
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

  return (
    <div class="border-1 border-edge-muted flex ml-1 items-stretch rounded-xs">
      <Tooltip
        tooltip={
          <div>
            {match(shareAccessLevelText())
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
              .otherwise(() => 'This item has been shared with you')}
          </div>
        }
      >
        <button
          class="text-xs hover:bg-hover text-ink px-2 flex items-center gap-1 h-full"
          onClick={() => {
            if (!isAuthenticated()) {
              openLoginModal();
            } else {
              analytics.track('share_menu_open', { blockType });
              shareCtx.open();
            }
          }}
        >
          <IconShared class="size-3.5" />
          Share
        </button>
      </Tooltip>

      <div class="w-[1px] bg-edge-muted" />

      <Button
        tooltip="Copy Share Link"
        onClick={ShareLinkAction().action}
        variant="ghost"
        size="icon-sm"
        class="p-1"
      >
        <Dynamic component={ShareLinkAction().icon} />
      </Button>
    </div>
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
      <DropdownMenu.Trigger disabled={props.disabled}>
        <Button
          disabled={props.disabled}
          class={`min-w-[67px] h-[22px] py-2 pl-2 pr-1 rounded-xs flex items-center gap-1 ${props.noBorder ? 'border-0 sm:border' : ''}`}
          variant="secondary"
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
                    class="flex items-center gap-2 w-full py-1 pl-2 pr-2 text-sm font-medium rounded-xs cursor-pointer hover:bg-hover hover-transition-bg focus-bracket"
                  >
                    <div class="w-4 h-4 shrink-0">
                      {Icon && <Icon class="w-full h-full" />}
                    </div>
                    <div class="flex-1 truncate">{option.label}</div>
                    <Show when={currentValue() === option.value}>
                      <CheckIcon class="w-3 h-3 text-accent" />
                    </Show>
                  </DropdownMenu.RadioItem>
                );
              }}
            </For>
            <Show when={!props.hideNoAccess}>
              <div class="my-1 border-t border-edge-muted w-full" />
              <DropdownMenu.RadioItem
                value="none"
                class="flex items-center gap-2 w-full py-1 pl-2 pr-2 text-sm font-medium rounded-xs cursor-pointer hover:bg-hover hover-transition-bg focus-bracket"
              >
                <div class="w-4 h-4 shrink-0">
                  <IconX class="w-full h-full" />
                </div>
                <div class="flex-1 truncate">{accessLevelText(null)}</div>
                <Show when={currentValue() === 'none'}>
                  <CheckIcon class="w-3 h-3 text-accent" />
                </Show>
              </DropdownMenu.RadioItem>
            </Show>
          </DropdownMenu.RadioGroup>
        </DropdownMenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
