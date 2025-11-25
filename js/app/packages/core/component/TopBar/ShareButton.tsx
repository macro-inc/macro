import { withAnalytics } from '@coparse/analytics';
import { TrackingEvents } from '@coparse/analytics/src/types/TrackingEvents';
import { useIsAuthenticated } from '@core/auth';
import {
  createBlockEffect,
  createBlockResource,
  useBlockId,
  useBlockName,
} from '@core/block';
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
import EyeSlash from '@icon/bold/eye-slash-bold.svg';
import GlobeIcon from '@icon/bold/globe-simple-bold.svg';
import LinkIconBold from '@icon/bold/link-bold.svg';
import Users from '@icon/bold/users-bold.svg';
import User from '@icon/regular/user.svg';
import { Dialog } from '@kobalte/core/dialog';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { Switch as KobalteSwitch } from '@kobalte/core/switch';
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
import { Button } from '../FormControls/Button';
import { ForwardToChannel } from '../ForwardToChannel';
import { IconButton } from '../IconButton';
import { DropdownMenuContent, MENU_ITEM_CLASS, MenuItem } from '../Menu';
import { Permissions } from '../SharePermissions';
import { TextButton } from '../TextButton';
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
      if (id === 'trash') return;
      return storageServiceClient.projects.getPermissions({ id });
    }
  },
  {
    initialValue: undefined,
  }
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
  id: string;
  name: string;
  userPermissions: Permissions;
  itemType: ItemType;
  isSharePermOpen: boolean;
  setIsSharePermOpen: (value: boolean) => void;
  owner?: string;
}

export function ShareModal(props: ShareModalProps) {
  const navigate = useNavigate();
  const { track } = withAnalytics();
  const [permissionsResource, { refetch }] = permissionsBlockResource;
  const userId = useUserId();

  const [channelNamesResource] = createResource(
    () => {
      const result = permissionsResource.latest;
      if (!result || isErr(result)) return;

      const [, sharePermission] = result;
      if (!sharePermission?.channelSharePermissions?.length) return;

      const channel_ids = sharePermission.channelSharePermissions.map(
        ({ channel_id }) => channel_id
      );

      return { channel_ids };
    },
    commsServiceClient.getBatchChannelPreviews,
    {
      initialValue: undefined,
    }
  );

  // Create a map of channel IDs to channel names
  const channelNameMap = createMemo(() => {
    const result = channelNamesResource.latest;
    if (!result || isErr(result)) return new Map();

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
          chat_id: props.id,
          sharePermission: {
            channelSharePermissions: [
              {
                operation: 'replace',
                channelId,
                accessLevel,
              },
            ],
          },
        });
      } else if (props.itemType === 'document') {
        result = await storageServiceClient.editDocument({
          documentId: props.id,
          sharePermission: {
            channelSharePermissions: [
              {
                operation: 'replace',
                channelId,
                accessLevel,
              },
            ],
          },
        });
      } else if (props.itemType === 'project') {
        result = await storageServiceClient.projects.edit({
          id: props.id,
          sharePermission: {
            channelSharePermissions: [
              {
                operation: 'replace',
                channelId,
                accessLevel,
              },
            ],
          },
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
    if (!currentPermissions || isErr(currentPermissions)) return;

    const [, sharePermission] = currentPermissions;
    return sharePermission.publicAccessLevel;
  });

  const isPublic = createMemo(() => {
    const currentPermissions = permissionsResource.latest;
    if (!currentPermissions || isErr(currentPermissions)) return;

    const [, sharePermission] = currentPermissions;
    return sharePermission.isPublic;
  });

  const togglePublicAccess = createCallback(async () => {
    const currentPermissions = permissionsResource.latest;
    if (!currentPermissions || isErr(currentPermissions)) return;

    const [, sharePermission] = currentPermissions;
    const newIsPublic = !sharePermission.isPublic;

    if (props.itemType === 'chat') {
      const result = await cognitionApiServiceClient.updateChatPermissions({
        chat_id: props.id,
        sharePermission: {
          isPublic: newIsPublic,
          publicAccessLevel: newIsPublic ? 'view' : null,
        },
      });
      if (!isErr(result)) {
        refetch();
        toast.success(
          newIsPublic ? 'Made chat public' : 'Made chat private',
          newIsPublic
            ? 'Anyone with the link can now view this chat'
            : 'Only shared users can access this chat'
        );
      } else {
        toast.alert('Failed to change chat access', 'Please try again');
        console.error(result);
      }
    } else if (props.itemType === 'document') {
      const result = await storageServiceClient.editDocument({
        documentId: props.id,
        sharePermission: {
          isPublic: newIsPublic,
          publicAccessLevel: newIsPublic ? 'view' : null,
        },
      });
      if (!isErr(result)) {
        refetch();
        toast.success(
          newIsPublic ? 'Made document public' : 'Made document private',
          newIsPublic
            ? 'Anyone with the link can now view this document'
            : 'Only shared users can access this document'
        );
      } else {
        toast.alert('Failed to change document access', 'Please try again');
        console.error(result);
      }
    } else if (props.itemType === 'project') {
      const result = await storageServiceClient.projects.edit({
        id: props.id,
        sharePermission: {
          isPublic: newIsPublic,
          publicAccessLevel: newIsPublic ? 'view' : null,
        },
      });
      if (!isErr(result)) {
        refetch();
        toast.success(
          newIsPublic ? 'Made folder public' : 'Made folder private',
          newIsPublic
            ? 'Anyone with the link can now view this folder'
            : 'Only shared users can access this folder'
        );
      } else {
        toast.alert('Failed to change folder access', 'Please try again');
        console.error(result);
      }
    }
  });

  const setPublicPermissions = createCallback(
    async (accessLevel: AccessLevel | null) => {
      if (props.itemType === 'chat') {
        console.error('Cannot set document permissions on chat');
        return;
      } else if (props.itemType === 'document') {
        const result = await storageServiceClient.editDocument({
          documentId: props.id,
          sharePermission: {
            isPublic: accessLevel != null,
            publicAccessLevel: accessLevel,
          },
        });
        if (!isErr(result)) {
          refetch();
          toast.success('Updated public link sharing access level');
        } else {
          toast.alert('Failed to change document access', 'Please try again');
          console.error(result);
        }
      } else if (props.itemType === 'project') {
        const result = await storageServiceClient.projects.edit({
          id: props.id,
          sharePermission: {
            isPublic: accessLevel != null,
            publicAccessLevel: accessLevel,
          },
        });
        if (!isErr(result)) {
          refetch();
          toast.success('Updated public link sharing access level');
        } else {
          toast.alert('Failed to change folder access', 'Please try again');
          console.error(result);
        }
      }
    }
  );

  const [lastModalOpen, setLastModalOpen] = createSignal(false);

  const formattedOwner = createMemo(() => {
    const ownerValue = props.owner;
    if (!ownerValue) return '';
    return ownerValue === userId() ? 'Me' : idToEmail(ownerValue).split('@')[0];
  });

  return (
    <Dialog
      open={props.isSharePermOpen}
      onOpenChange={props.setIsSharePermOpen}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="z-modal-overlay fixed inset-0 flex justify-center items-center bg-modal-overlay portal-scope">
          <Dialog.Content class="z-modal-content my-auto w-[440px] max-h-[100%] overflow-y-auto text-ink">
            <div class="z-0 relative">
              <div class="z-3 relative bg-dialog shadow-xl p-2.5 border-1 border-edge rounded-xl w-full">
                <ForwardToChannel
                  name={props.name}
                  onSubmit={() => props.setIsSharePermOpen(false)}
                  refetch={refetch}
                  submitPermissionInfo={{
                    userPermissions: props.userPermissions,
                    channelSharePermissions: recipients(),
                    setChannelPermissions: (id, accessLevel) =>
                      setChannelPermissions(id, accessLevel, true),
                  }}
                />
              </div>
              <Show when={recipients() || props.owner}>
                <div class="z-2 relative">
                  <div class="bg-input shadow-xl mt-4 p-2 pl-4 border-1 border-edge rounded-xl w-full">
                    <div class="pt-0.5 pb-2 pl-0.5 font-medium text-ink text-md select-none">
                      Share Recipients
                    </div>
                    <div class="flex w-full h-fit max-h-[120px] overflow-y-auto">
                      <table class="w-full text-ink text-sm border-collapse">
                        <tbody class="select-none">
                          <Show when={props.owner}>
                            <tr class="rounded-md">
                              <td class="py-1 w-full min-w-0">
                                <div class="flex items-center gap-2 overflow-hidden">
                                  <UserIcon
                                    id={props.owner!}
                                    size="xs"
                                    isDeleted={false}
                                  />
                                  <div class="font-medium truncate">
                                    {formattedOwner()}
                                  </div>
                                </div>
                              </td>
                              <td class="align-middle">
                                <div class={MENU_ITEM_CLASS}>Owner</div>
                              </td>
                            </tr>
                          </Show>
                          <Show when={recipients()}>
                            <For each={recipients()!}>
                              {(recipient) => (
                                <tr class="hover:bg-hover rounded-md hover-transition-bg">
                                  <td
                                    class="py-1 w-full min-w-0 cursor-pointer"
                                    onClick={() =>
                                      navigateToChannel(recipient.channel_id)
                                    }
                                  >
                                    <div class="flex items-center gap-2 overflow-hidden">
                                      <Switch>
                                        <Match
                                          when={channelNameMap().get(
                                            recipient.channel_id
                                          )}
                                        >
                                          <User class="flex-shrink-0 w-4 h-4" />
                                        </Match>
                                        <Match when={true}>
                                          <Users class="flex-shrink-0 w-4 h-4" />
                                        </Match>
                                      </Switch>
                                      <div class="font-medium truncate">
                                        {channelNameMap().get(
                                          recipient.channel_id
                                        )?.name || recipient.channel_id}
                                      </div>
                                    </div>
                                  </td>
                                  <td class="align-middle">
                                    <div class="font-medium text-ink-muted text-xs">
                                      <ShareOptions
                                        permissions={recipient.access_level}
                                        setPermissions={(accessLevel) => {
                                          if (accessLevel === null) {
                                            removeChannelAccess(
                                              recipient.channel_id
                                            );
                                          } else if (
                                            accessLevel !==
                                            recipient.access_level
                                          ) {
                                            setChannelPermissions(
                                              recipient.channel_id,
                                              accessLevel
                                            );
                                          }
                                        }}
                                      />
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </For>
                          </Show>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </Show>
              <Show when={props.userPermissions === Permissions.OWNER}>
                <div class={`relative ${lastModalOpen() ? `z-3` : `z-1`}`}>
                  <div class="bg-dialog shadow-xl mt-4 p-3 border-1 border-edge rounded-xl w-full">
                    <div class="flex flex-row justify-between items-center mb-1 align-middle">
                      <div class="flex flex-col gap-0.5">
                        <div class="font-medium text-ink text-base select-none">
                          Public link sharing is {isPublic() ? 'on' : 'off'}
                        </div>
                        <div class="font-medium text-ink-muted text-sm">
                          {isPublic()
                            ? 'Anyone with the link can access'
                            : 'Share recipients still have access'}
                        </div>
                      </div>

                      <KobalteSwitch
                        checked={isPublic()}
                        onChange={togglePublicAccess}
                      >
                        <KobalteSwitch.Input class="sr-only" />
                        <KobalteSwitch.Control class="inline-flex bg-edge/30 data-[checked]:bg-accent mt-1 border-2 border-transparent rounded-full focus-visible:outline-none hover:ring-1 hover:ring-edge focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 w-11 h-6 transition-colors">
                          <KobalteSwitch.Thumb class="block bg-dialog rounded-full w-5 h-5 transition-transform data-[checked]:translate-x-5" />
                        </KobalteSwitch.Control>
                      </KobalteSwitch>
                    </div>
                    <Show when={props.itemType !== 'chat'}>
                      {/* @daniel: TODO - Proper fix for z indexes */}
                      <ShareOptions
                        permissions={publicAccessLevel() ?? null}
                        setPermissions={setPublicPermissions}
                        setLastModalOpen={setLastModalOpen}
                      />
                    </Show>
                  </div>
                </div>
              </Show>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog>
  );
}
interface ShareButtonProps {
  id: string; // document id or chat id
  name: string; // document name or chat name
  userPermissions: Permissions; // user permissions are in service-storage/cognition V2 are unified @sharePermissionV2.ts
  copyLink?: () => void; // some blocks have their own copy link function e.g. canvas copies current (x,y) position
  itemType: ItemType;
  owner?: string;
}

export function ShareButton(props: ShareButtonProps) {
  const [permissionsResource] = permissionsBlockResource;
  const [isSharePermOpen, setIsSharePermOpen] = createSignal(false);
  const isAuthenticated = useIsAuthenticated();
  const blockScopeId = blockHotkeyScopeSignal.get;

  const blockId = useBlockId();
  const blockType = useBlockName();

  onMount(() => {
    registerHotkey({
      hotkey: 'cmd+s',
      scopeId: blockScopeId(),
      description: 'Share',
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
    });
  });

  const defaultUrl = () => {
    return buildSimpleEntityUrl(
      {
        type: blockType,
        id: blockId ?? '',
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
      icon: LinkIconBold,
    };
  });

  const shareAccessLevelText = createMemo(() => {
    const maybeResult = permissionsResource.latest;
    if (!maybeResult || isErr(maybeResult)) return '';

    const [, sharePermission] = maybeResult;
    if (sharePermission.isPublic) return 'Public';
    if (sharePermission.channelSharePermissions?.length) return 'Shared';

    return 'Just me';
  });

  return (
    <>
      <div class="ml-1 border-ink border">
        <IconButton
          size="xs"
          theme="reverse"
          icon={ShareLinkAction().icon}
          onClick={ShareLinkAction().action}
          tooltip={{ label: 'Copy Share Link' }}
        />
      </div>
      <div class="bg-ink w-1 h-[4px]"></div>
      <Button
        size="XS"
        hotkeyToken={'block.share'}
        onClick={(e) => {
          if (!isAuthenticated()) {
            openLoginModal();
          } else {
            track(TrackingEvents.SHARE.OPEN);
            ShareLinkAction().action(e);
            setIsSharePermOpen(true);
          }
        }}
      >
        <div class="flex flex-row items-center">
          <Show
            when={shareAccessLevelText() !== ''}
            // use this fallback to force the button to correct height without icons
            fallback={<div class="w-0 h-3" />}
          >
            <div class="mr-1 font-medium text-panel/80 text-sm text-nowrap">
              <Switch>
                <Match when={shareAccessLevelText() === 'Public'}>
                  <Tooltip
                    tooltip={
                      <div>Anyone with the link can access this document</div>
                    }
                  >
                    <GlobeIcon class="size-3" />
                  </Tooltip>
                </Match>
                <Match when={shareAccessLevelText() === 'Shared'}>
                  <Tooltip
                    tooltip={<div>Shared with specific people or channels</div>}
                  >
                    <Users class="size-3" />
                  </Tooltip>
                </Match>
                <Match when={shareAccessLevelText() === 'Just me'}>
                  <Tooltip
                    tooltip={<div>Only you can access this document</div>}
                  >
                    <EyeSlash class="size-3" />
                  </Tooltip>
                </Match>
              </Switch>
            </div>
          </Show>
          Share
        </div>
      </Button>
      <ShareModal
        id={props.id}
        name={props.name}
        userPermissions={props.userPermissions}
        itemType={props.itemType}
        isSharePermOpen={isSharePermOpen()}
        setIsSharePermOpen={setIsSharePermOpen}
        owner={props.owner}
      />
    </>
  );
}

export function ShareOptions(props: {
  permissions?: AccessLevel | null;
  setPermissions: (accessLevel: AccessLevel | null) => void;
  disabled?: boolean;
  hideNoAccess?: boolean;
  setLastModalOpen?: (value: boolean) => void; // @daniel: TODO - Proper fix for z indexes
}) {
  const [open, setOpen] = createSignal(false);
  const setLastModalOpen = props.setLastModalOpen;
  if (setLastModalOpen) {
    createEffect(() => {
      setLastModalOpen(open());
    });
  }

  const editPermissionEnabled = blockEditPermissionEnabledSignal();
  const blockName = useBlockName();

  return (
    <DropdownMenu open={open()} onOpenChange={setOpen} sameWidth>
      <DropdownMenu.Trigger>
        <TextButton
          theme="clear"
          showChevron
          disabled={props.disabled}
          tabIndex={-1}
        >
          {accessLevelText(props.permissions)}
        </TextButton>
      </DropdownMenu.Trigger>
      <DropdownMenuContent>
        <Show when={blockName !== 'md' || ENABLE_MARKDOWN_COMMENTS}>
          <MenuItem
            text={accessLevelText('comment')}
            onClick={() => {
              props.setPermissions('comment');
            }}
          />
        </Show>
        <MenuItem
          text={accessLevelText('view')}
          onClick={() => {
            props.setPermissions('view');
          }}
        />
        <Show when={editPermissionEnabled}>
          <MenuItem
            text={accessLevelText('edit')}
            onClick={() => {
              props.setPermissions('edit');
            }}
          />
        </Show>
        <Show when={!props.hideNoAccess}>
          <MenuItem
            text={accessLevelText(null)}
            onClick={() => {
              props.setPermissions(null);
            }}
          />
        </Show>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
