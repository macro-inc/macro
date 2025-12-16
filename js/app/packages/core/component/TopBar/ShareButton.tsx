import { createMemo, createResource, createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { blockNameToItemType, type ItemType, storageServiceClient } from '@service-storage/client';
import { createBlockEffect, createBlockResource, useBlockId, useBlockName} from '@core/block';
import { isErr, isOk, type MaybeError, type MaybeResult } from '@core/util/maybeResult';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { TrackingEvents } from '@coparse/analytics/src/types/TrackingEvents';
import { beveledCorners } from '../../../block-theme/signals/themeSignals';
import { DropdownMenuContent, MENU_ITEM_CLASS, MenuItem } from '../Menu';
import { ENABLE_MARKDOWN_COMMENTS } from '@core/constant/featureFlags';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { blockEditPermissionEnabledSignal } from '@core/signal/load';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { Switch as KobalteSwitch } from '@kobalte/core/switch';
import { useIsDocumentOwner } from '@core/signal/permissions';
import { createCallback } from '@solid-primitives/rootless';
import { commsServiceClient } from '@service-comms/client';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import clickOutside from '@core/directive/clickOutside';
import IconEyeSlash from '@icon/regular/eye-slash.svg';
import { ForwardToChannel } from '../ForwardToChannel';
import { buildSimpleEntityUrl } from '@core/util/url';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { UserIcon } from '@core/component/UserIcon';
import { withAnalytics } from '@coparse/analytics';
import { Permissions } from '../SharePermissions';
import { useIsAuthenticated } from '@core/auth';
import IconGlobe from '@icon/regular/globe.svg';
import IconUsers from '@icon/regular/users.svg';
import { useUserId } from '@service-gql/client';
import { openLoginModal } from './LoginButton';
import { DialogWrapper } from '../DialogWrapper';
import { ClippedPanel } from '../ClippedPanel';
import { useNavigate } from '@solidjs/router';
import IconLink from '@icon/regular/link.svg';
import { Dialog } from '@kobalte/core/dialog';
import { TOKENS } from '@core/hotkey/tokens';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import User from '@icon/regular/user.svg';
import { idToEmail } from '@core/user';
import { toast } from '../Toast/Toast';
import { Tooltip } from '../Tooltip';

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
    if(itemType === 'chat'){return cognitionApiServiceClient.getChatPermissions({ id })}
    else if(itemType === 'document'){return storageServiceClient.getDocumentPermissions({ document_id: id })}
    else if(itemType === 'project'){
      if(id === 'trash'){return};
      return storageServiceClient.projects.getPermissions({ id });
    }
  },
  {initialValue: undefined}
);

createBlockEffect(() => {
  const [, { refetch }] = permissionsBlockResource;
  setRefetchArray((prev) => [...prev, refetch]);
  onCleanup(() => {setRefetchArray((prev) => prev.filter((r) => r !== refetch))});
});

const accessLevelText = (accessLevel?: AccessLevel | null) => {
  const blockName = useBlockName();
  switch(accessLevel){
    case 'comment': if(blockName === 'md' && !ENABLE_MARKDOWN_COMMENTS){return 'View'}; return 'Comment';
    case 'view': return 'View';
    case 'edit': return 'Edit';
    case 'owner': return 'Owner';
    default: return 'No Access';
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
    { initialValue: undefined}
  );

  // Create a map of channel IDs to channel names
  const channelNameMap = createMemo(() => {
    const result = channelNamesResource.latest;
    if(!result || isErr(result)){return new Map()};

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
      if(!isErr(result)){
        refetch();
        toast.success(
          'Removed channel access',
          'Channel no longer has access to this chat'
        );
      }
      else{
        toast.alert('Failed to remove channel access', 'Please try again');
        console.error(result);
      }
    }
    else if(props.itemType === 'document'){
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
      if(!isErr(result)){
        refetch();
        toast.success(
          'Removed channel access',
          'Channel no longer has access to this document'
        );
      }
      else{
        toast.alert('Failed to remove channel access', 'Please try again');
        console.error(result);
      }
    }
    else if(props.itemType === 'project'){
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
      if(!isErr(result)){
        refetch();
        toast.success('Removed folder access');
      }
      else{
        toast.alert('Failed to remove folder access', 'Please try again');
        console.error(result);
      }
    }
  });

  const setChannelPermissions = createCallback(
    async (channelId: string, accessLevel: AccessLevel, hideSuccessToast?: boolean) => {
      if (props.userPermissions !== Permissions.OWNER) return;

      let result: MaybeResult<any, any> | MaybeError<any> | null = null;
      if(props.itemType === 'chat'){
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
      }

      if(result && isOk(result)){
        refetch();
        if(!hideSuccessToast){toast.success( 'Changed channel access level', accessLevelText(accessLevel))}
      }
      else{
        toast.alert('Failed to change channel access', 'Please try again');
        console.error(result);
      }
    }
  );

  const publicAccessLevel = createMemo(() => {
    const currentPermissions = permissionsResource.latest;
    if(!currentPermissions || isErr(currentPermissions)){return}

    const [, sharePermission] = currentPermissions;
    return sharePermission.publicAccessLevel;
  });

  const isPublic = createMemo(() => {
    const currentPermissions = permissionsResource.latest;
    if(!currentPermissions || isErr(currentPermissions)){return};

    const [, sharePermission] = currentPermissions;
    return sharePermission.isPublic;
  });

  const togglePublicAccess = createCallback(async () => {
    const currentPermissions = permissionsResource.latest;
    if(!currentPermissions || isErr(currentPermissions)){return};

    const [, sharePermission] = currentPermissions;
    const newIsPublic = !sharePermission.isPublic;

    if(props.itemType === 'chat'){
      const result = await cognitionApiServiceClient.updateChatPermissions({
        sharePermission: {
          publicAccessLevel: newIsPublic ? 'view' : null,
          isPublic: newIsPublic
        },
        chat_id: props.id
      });
      if(!isErr(result)){
        refetch();
        toast.success(
          newIsPublic ? 'Made chat public' : 'Made chat private',
          newIsPublic ? 'Anyone with the link can now view this chat' : 'Only shared users can access this chat'
        );
      }
      else{
        toast.alert('Failed to change chat access', 'Please try again');
        console.error(result);
      }
    }
    else if(props.itemType === 'document'){
      const result = await storageServiceClient.editDocument({
        sharePermission: {
          publicAccessLevel: newIsPublic ? 'view' : null,
          isPublic: newIsPublic,
        },
        documentId: props.id
      });
      if(!isErr(result)){
        refetch();
        toast.success(
          newIsPublic ? 'Made document public' : 'Made document private',
          newIsPublic ? 'Anyone with the link can now view this document' : 'Only shared users can access this document'
        );
      }
      else{
        toast.alert('Failed to change document access', 'Please try again');
        console.error(result);
      }
    }
    else if(props.itemType === 'project') {
      const result = await storageServiceClient.projects.edit({
        sharePermission: {
          publicAccessLevel: newIsPublic ? 'view' : null,
          isPublic: newIsPublic,
        },
        id: props.id
      });
      if(!isErr(result)){
        refetch();
        toast.success(
          newIsPublic ? 'Made folder public' : 'Made folder private',
          newIsPublic ? 'Anyone with the link can now view this folder' : 'Only shared users can access this folder'
        );
      }
      else{
        toast.alert('Failed to change folder access', 'Please try again');
        console.error(result);
      }
    }
  });

  const setPublicPermissions = createCallback(
    async(accessLevel: AccessLevel | null) => {
      if(props.itemType === 'chat'){
        console.error('Cannot set document permissions on chat');
        return;
      }
      else if(props.itemType === 'document'){
        const result = await storageServiceClient.editDocument({
          sharePermission: {
            publicAccessLevel: accessLevel,
            isPublic: accessLevel != null,
          },
          documentId: props.id
        });
        if(!isErr(result)){
          refetch();
          toast.success('Updated public link sharing access level');
        }
        else{
          toast.alert('Failed to change document access', 'Please try again');
          console.error(result);
        }
      }
      else if(props.itemType === 'project'){
        const result = await storageServiceClient.projects.edit({
          sharePermission: {
            publicAccessLevel: accessLevel,
            isPublic: accessLevel != null,
          },
          id: props.id
        });
        if(!isErr(result)){
          refetch();
          toast.success('Updated public link sharing access level');
        }
        else{
          toast.alert('Failed to change folder access', 'Please try again');
          console.error(result);
        }
      }
    }
  );



  const formattedOwner = createMemo(() => {
    const ownerValue = props.owner;
    if(!ownerValue){return ''};
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
                <ForwardToChannel
                  submitPermissionInfo={{
                    setChannelPermissions: (id, accessLevel) => setChannelPermissions(id, accessLevel, true),
                    userPermissions: props.userPermissions,
                    channelSharePermissions: recipients(),
                  }}
                  onSubmit={() => props.setIsSharePermOpen(false)}
                  refetch={refetch}
                  name={props.name}
                />

              <Show when={recipients() || props.owner}>
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
                                isDeleted={false}
                                id={props.owner!}
                                size="xs"
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
                                onClick={() => navigateToChannel(recipient.channel_id)}
                                class="py-1 w-full min-w-0 cursor-pointer"
                              >
                                <div class="flex items-center gap-2 overflow-hidden">
                                  <Switch>
                                    <Match when={channelNameMap().get(recipient.channel_id)}>
                                      <User class="flex-shrink-0 w-4 h-4" />
                                    </Match>
                                    <Match when={true}>
                                      <IconUsers class="flex-shrink-0 w-4 h-4" />
                                    </Match>
                                  </Switch>
                                  <div class="font-medium truncate">
                                    {channelNameMap().get(recipient.channel_id)?.name || recipient.channel_id}
                                  </div>
                                </div>
                              </td>
                              <td class="align-middle">
                                <div class="font-medium text-ink-muted text-xs">
                                  <ShareOptions
                                    permissions={recipient.access_level}
                                    setPermissions={(accessLevel) => {
                                      if(accessLevel === null){removeChannelAccess(recipient.channel_id)}
                                      else if(accessLevel !== recipient.access_level){setChannelPermissions(recipient.channel_id, accessLevel)}
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
              </Show>

              <Show when={props.userPermissions === Permissions.OWNER}>
                <div class="flex flex-row justify-between items-center mb-1 align-middle">
                  <div class="flex flex-col gap-0.5">
                    <div class="font-medium text-ink text-base select-none">
                      Public link sharing is {isPublic() ? 'on' : 'off'}
                    </div>
                    <div class="font-medium text-ink-muted text-sm">
                      {isPublic() ? 'Anyone with the link can access' : 'Share recipients still have access'}
                    </div>
                  </div>

                  <KobalteSwitch
                    onChange={togglePublicAccess}
                    checked={isPublic()}
                  >
                    <KobalteSwitch.Input class="sr-only" />
                    <KobalteSwitch.Control class="inline-flex bg-edge/30 data-[checked]:bg-accent mt-1 border-2 border-transparent rounded-full focus-visible:outline-none hover:ring-1 hover:ring-edge focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 w-11 h-6 transition-colors">
                      <KobalteSwitch.Thumb class="block bg-dialog rounded-full w-5 h-5 transition-transform data-[checked]:translate-x-5" />
                    </KobalteSwitch.Control>
                  </KobalteSwitch>
                </div>

                <Show when={props.itemType !== 'chat'}>
                  <ShareOptions
                    permissions={publicAccessLevel() ?? null}
                    setPermissions={setPublicPermissions}
                  />
                </Show>
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
        if(!isAuthenticated()){openLoginModal()}
        else{
          track(TrackingEvents.SHARE.OPEN);
          setIsSharePermOpen(true);
        }
        return true;
      },
      hotkeyToken: TOKENS.block.share,
      runWithInputFocused: true,
      scopeId: blockScopeId(),
      description: 'Share',
      hotkey: 'cmd+s'
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
    if(props.copyLink){return props.copyLink()}

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
    if(!maybeResult || isErr(maybeResult)){return ''}
    const [, sharePermission] = maybeResult;
    if(sharePermission.isPublic){return 'Public'}
    if(sharePermission.channelSharePermissions?.length){return 'Shared'}
    return 'Just me';
  });

  return (
    <>
      <div class="border-1 border-edge-muted flex">
        <Tooltip tooltip={
          <div>
            {shareAccessLevelText() === 'Public' && 'Anyone with the link can access this document'}
            {shareAccessLevelText() === 'Shared' && 'Shared with specific people or channels'}
            {shareAccessLevelText() === 'Just me' && 'Only you can access this document'}
          </div>
        }>
          <button
            class="text-xs hover:bg-hover text-ink p-1 flex items-center gap-1"
            onClick={(e) => {
              if(!isAuthenticated()){openLoginModal();
              }
              else{
                track(TrackingEvents.SHARE.OPEN);
                ShareLinkAction().action(e);
                setIsSharePermOpen(true);
              }
            }}
          >
            &nbsp;Share
            {shareAccessLevelText() === 'Public' && <IconGlobe class="size-4" />}
            {shareAccessLevelText() === 'Shared' && <IconUsers class="size-4" />}
            {shareAccessLevelText() === 'Just me' && <IconEyeSlash class="size-4" />}
          </button>
        </Tooltip>

        <div class="h-[24px] w-[1px] bg-edge-muted" />

        <IconButton
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
  disabled?: boolean;
}){
  const [open, setOpen] = createSignal(false);
  const editPermissionEnabled = blockEditPermissionEnabledSignal();
  const blockName = useBlockName();

  return (
    <DropdownMenu open={open()} onOpenChange={setOpen} sameWidth>
      <DropdownMenu.Trigger>
        <TextButton
          disabled={props.disabled}
          tabIndex={-1}
          theme="clear"
          showChevron
        >
          {accessLevelText(props.permissions)}
        </TextButton>
      </DropdownMenu.Trigger>
      <DropdownMenuContent>
        <Show when={blockName !== 'md' || ENABLE_MARKDOWN_COMMENTS}>
          <MenuItem
            onClick={() => {props.setPermissions('comment')}}
            text={accessLevelText('comment')}
          />
        </Show>
        <MenuItem
          onClick={() => {props.setPermissions('view')}}
          text={accessLevelText('view')}
        />
        <Show when={editPermissionEnabled}>
          <MenuItem
            onClick={() => {props.setPermissions('edit')}}
            text={accessLevelText('edit')}
          />
        </Show>
        <Show when={!props.hideNoAccess}>
          <MenuItem
            onClick={() => {props.setPermissions(null)}}
            text={accessLevelText(null)}
          />
        </Show>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
