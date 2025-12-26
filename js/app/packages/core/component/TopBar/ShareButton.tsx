import { withAnalytics } from '@coparse/analytics';
import { TrackingEvents } from '@coparse/analytics/src/types/TrackingEvents';
import { useIsAuthenticated } from '@core/auth';
import {
  createBlockEffect,
  createBlockResource,
  useBlockId,
  useBlockName,
} from '@core/block';
import { DeprecatedTextButton } from '@core/component/DeprecatedTextButton';
import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import { UserIcon } from '@core/component/UserIcon';
import { ENABLE_MARKDOWN_COMMENTS } from '@core/constant/featureFlags';
import clickOutside from '@core/directive/clickOutside';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { blockEditPermissionEnabledSignal } from '@core/signal/load';
import { useIsDocumentOwner } from '@core/signal/permissions';
import { idToEmail } from '@core/user';
import {
  isErr,
  isOk,
  type MaybeError,
  type MaybeResult,
} from '@core/util/maybeResult';
import { buildSimpleEntityUrl } from '@core/util/url';
import IconEyeSlash from '@icon/regular/eye-slash.svg';
import IconGlobe from '@icon/regular/globe.svg';
import IconLink from '@icon/regular/link.svg';
import IconShared from '@icon/regular/share.svg';
import User from '@icon/regular/user.svg';
import IconUsers from '@icon/regular/users.svg';
import CloseIcon from '@icon/regular/x.svg';
import { Dialog } from '@kobalte/core/dialog';
import PaperPlaneRight from '@phosphor-icons/core/fill/paper-plane-right-fill.svg?component-solid';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { commsServiceClient } from '@service-comms/client';
import { useUserId } from '@service-gql/client';
import {
  blockNameToItemType,
  type ItemType,
  storageServiceClient,
} from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { createCallback } from '@solid-primitives/rootless';
import { useNavigate } from '@solidjs/router';
import {
  createEffect,
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
import { match } from 'ts-pattern';
import { beveledCorners } from '../../../block-theme/signals/themeSignals';
import { ClippedPanel } from '../ClippedPanel';
import { DeprecatedIconButton } from '../DeprecatedIconButton';
import { DialogWrapper } from '../DialogWrapper';
import { ForwardToChannel } from '../ForwardToChannel';
import { MENU_ITEM_CLASS } from '../Menu';
import { Permissions } from '../SharePermissions';
import { toast } from '../Toast/Toast';
import { Tooltip } from '../Tooltip';
import { openLoginModal } from './LoginButton';

false && clickOutside;

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
  const blockName = useBlockName();
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
      return 'No Access';
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
  itemType: ItemType;
  owner?: string;
  name: string;
  id: string;
}

export function ShareModal(props: ShareModalProps) {
  const navigate = useNavigate();
  const { track } = withAnalytics();
  const [permissionsResource, { refetch }] = permissionsBlockResource;
  const userId = useUserId();
  const [submitAccessLevel, setSubmitAccessLevel] =
    createSignal<AccessLevel | null>(null);
  const [forwardToChannelRef, setForwardToChannelRef] = createSignal<any>(null);

  createEffect(() => {
    const ref = forwardToChannelRef();
    if (ref && ref.getSubmitAccessLevel) {
      const currentLevel = ref.getSubmitAccessLevel();
      setSubmitAccessLevel(currentLevel);
    }
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
    track(TrackingEvents.SHARE.CLOSE);
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
        <Dialog.Overlay class="fixed inset-0 z-modal-overlay bg-transparent" />
        <DialogWrapper>
          <Dialog.Content class="text-ink max-h-[100%] overflow-y-auto">
            <ClippedPanel tl={!beveledCorners()} active>
              <div class="flex flex-row items-center justify-between px-2 h-[40px] gap-2 border-b-1 border-b-edge-muted">
                <div class="flex flex-row items-center gap-2">
                  <Dialog.CloseButton>
                    <DeprecatedIconButton
                      tooltip={{ label: 'Close' }}
                      icon={CloseIcon}
                      iconSize={16}
                      theme="clear"
                      size="sm"
                    />
                  </Dialog.CloseButton>
                  <Dialog.Title class="text-sm">{`Share: ${props.name}`}</Dialog.Title>
                </div>

                <div class="flex flex-row items-center gap-2">
                  <Show when={props.userPermissions === Permissions.OWNER}>
                    <ShareOptions
                      setPermissions={(accessLevel) => {
                        setSubmitAccessLevel(accessLevel);
                        forwardToChannelRef()?.setSubmitAccessLevel(
                          accessLevel
                        );
                      }}
                      permissions={submitAccessLevel()}
                      label="Permission"
                      hideNoAccess
                    />
                  </Show>

                  <DeprecatedTextButton
                    onClick={() => {
                      const selectedOptions =
                        forwardToChannelRef()?.getSelectedOptions();
                      if (selectedOptions && selectedOptions.length > 0) {
                        forwardToChannelRef()?.handleSubmit();
                      }
                    }}
                    theme={
                      forwardToChannelRef()?.getSelectedOptions()?.length > 0
                        ? 'accent'
                        : 'disabled'
                    }
                    icon={PaperPlaneRight}
                    height="h-[22px]"
                    text="Share"
                  />
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
                ref={setForwardToChannelRef}
                refetch={refetch}
                name={props.name}
              />

              <Show when={recipients() || props.owner}>
                <div class="border-t-1 border-edge-muted w-full h-fit max-h-[120px] overflow-y-auto">
                  <div class="grid gap-[1px] bg-edge-muted/50 text-ink text-sm select-none">
                    <Show when={props.owner}>
                      <div class="contents rounded-md">
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
                          <div class={MENU_ITEM_CLASS}>Owner</div>
                        </div>
                      </div>
                    </Show>

                    <Show when={recipients()}>
                      <For each={recipients()!}>
                        {(recipient) => (
                          <div class="flex justify-between p-2 bg-panel hover:bg-hover hover-transition-bg group">
                            <div
                              class="flex items-center gap-2 overflow-hidden cursor-pointer group-hover:bg-hover"
                              onClick={() =>
                                navigateToChannel(recipient.channel_id)
                              }
                            >
                              <Switch>
                                <Match
                                  when={channelNameMap().get(
                                    recipient.channel_id
                                  )}
                                >
                                  <User class="flex-shrink-0 w-4 h-4" />
                                </Match>
                                <Match when={true}>
                                  <IconUsers class="flex-shrink-0 w-4 h-4" />
                                </Match>
                              </Switch>
                              <div class="font-medium truncate">
                                {channelNameMap().get(recipient.channel_id)
                                  ?.name || recipient.channel_id}
                              </div>
                            </div>
                            <div class="flex items-center group-hover:bg-hover">
                              <div class="font-medium text-ink-muted text-xs">
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
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                </div>
              </Show>

              <Show when={props.userPermissions === Permissions.OWNER}>
                <div class="flex gap-2 border-t-1 items-center px-2 border-edge-muted h-[40px]">
                  <ShareOptions
                    permissions={publicAccessLevel() ?? null}
                    hideNoAccess={props.itemType === 'chat'}
                    setPermissions={setPublicPermissions}
                    label="Link&nbsp;Permission"
                  />
                </div>
              </Show>
            </ClippedPanel>
          </Dialog.Content>
        </DialogWrapper>
      </Dialog.Portal>
    </Dialog>
  );
}
interface ShareButtonProps {
  userPermissions: Permissions; // user permissions are in service-storage/cognition V2 are unified @sharePermissionV2.ts
  copyLink?: () => void; // some blocks have their own copy link function e.g. canvas copies current (x,y) position
  name: string; // document name or chat name
  id: string; // document id or chat id
  itemType: ItemType;
  owner?: string;
}

export function ShareButton(props: ShareButtonProps) {
  const [isSharePermOpen, setIsSharePermOpen] = createSignal(false);
  const [permissionsResource] = permissionsBlockResource;
  const blockScopeId = blockHotkeyScopeSignal.get;
  const isAuthenticated = useIsAuthenticated();
  const blockType = useBlockName();
  const blockId = useBlockId();

  onMount(() => {
    registerHotkey({
      keyDownHandler: () => {
        if (!isAuthenticated()) {
          openLoginModal();
        } else {
          track(TrackingEvents.SHARE.OPEN);
          setIsSharePermOpen(true);
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

  const defaultUrl = () => {
    return buildSimpleEntityUrl(
      {
        id: blockId ?? '',
        type: blockType,
      },
      {}
    );
  };

  const { track } = withAnalytics();

  const copyLink = createCallback(() => {
    if (props.copyLink) {
      return props.copyLink();
    }

    navigator.clipboard.writeText(defaultUrl());
    toast.success(
      'Link copied to clipboard.',
      'Sending this link in a Macro message will automatically update permissions to include recipients.'
    );
  });

  const ShareLinkAction = createMemo(() => {
    return {
      action: (e: MouseEvent | KeyboardEvent) => {
        e.stopPropagation();
        copyLink();
      },
      icon: IconLink,
    };
  });

  const shareAccessLevelText = createMemo(() => {
    const maybeResult = permissionsResource.latest;
    if (!maybeResult || isErr(maybeResult)) {
      return '';
    }
    const [, sharePermission] = maybeResult;
    if (sharePermission.isPublic) {
      return 'Public';
    }
    if (sharePermission.channelSharePermissions?.length) {
      return 'Shared';
    }
    return 'Just me';
  });

  return (
    <>
      <div class="border-1 border-edge-muted flex ml-1 items-stretch">
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
            class="text-[0.75rem] font-mono tracking-wide hover:bg-hover text-ink px-2 flex items-center gap-1 h-full"
            onClick={() => {
              if (!isAuthenticated()) {
                openLoginModal();
              } else {
                track(TrackingEvents.SHARE.OPEN);
                setIsSharePermOpen(true);
              }
            }}
          >
            <Switch fallback={<IconShared class="size-4" />}>
              <Match when={shareAccessLevelText() === 'Public'}>
                <IconGlobe class="size-4" />
              </Match>
              <Match when={shareAccessLevelText() === 'Shared'}>
                <IconUsers class="size-4" />
              </Match>
              <Match when={shareAccessLevelText() === 'Just me'}>
                <IconEyeSlash class="size-4" />
              </Match>
            </Switch>
            SHARE
          </button>
        </Tooltip>

        <div class="w-[1px] bg-edge-muted" />

        <DeprecatedIconButton
          tooltip={{ label: 'Copy Share Link' }}
          onClick={ShareLinkAction().action}
          icon={ShareLinkAction().icon}
          theme="clear"
          size="sm"
        />
      </div>

      <ShareModal
        setIsSharePermOpen={setIsSharePermOpen}
        userPermissions={props.userPermissions}
        isSharePermOpen={isSharePermOpen()}
        itemType={props.itemType}
        owner={props.owner}
        name={props.name}
        id={props.id}
      />
    </>
  );
}

export function ShareOptions(props: {
  setPermissions: (accessLevel: AccessLevel | null) => void;
  permissions?: AccessLevel | null;
  hideNoAccess?: boolean;
  label?: string | '';
  disabled?: boolean;
}) {
  const editPermissionEnabled = blockEditPermissionEnabledSignal();
  const blockName = useBlockName();

  const options = createMemo(() => {
    const optionsList: { value: string; label: string }[] = [];

    // Add comment option if applicable
    if (blockName !== 'md' || ENABLE_MARKDOWN_COMMENTS) {
      optionsList.push({ value: 'comment', label: accessLevelText('comment') });
    }

    // Always add view option
    optionsList.push({ value: 'view', label: accessLevelText('view') });

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

  const handleChange = (value: string) => {
    if (value === 'none') {
      props.setPermissions(null);
    } else {
      props.setPermissions(value as AccessLevel);
    }
  };

  return (
    <SegmentedControl
      disabled={props.disabled}
      onChange={handleChange}
      value={currentValue()}
      label={props.label}
      list={options()}
      size="SM"
    />
  );
}
