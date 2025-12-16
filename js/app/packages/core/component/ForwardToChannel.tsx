import type { SharePermissionV2ChannelSharePermissions } from '@service-storage/generated/schemas/sharePermissionV2ChannelSharePermissions';
import PaperPlaneRight from '@phosphor-icons/core/fill/paper-plane-right-fill.svg?component-solid';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { useChannelMarkdownArea } from '@block-channel/component/MarkdownArea';
import { TrackingEvents } from '@coparse/analytics/src/types/TrackingEvents';
import { useBlockAliasedName, useBlockId, useBlockName } from '@core/block';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { Switch as KobalteSwitch } from '@kobalte/core/switch';
import { blockNameToItemType } from '@service-storage/client';
import { useSendMessageToPeople } from '@core/util/channels';
import { getDestinationFromOptions } from './NewMessage';
import type { WithCustomUserInput } from '@core/user';
import { ShareOptions } from './TopBar/ShareButton';
import { withAnalytics } from '@coparse/analytics';
import { Permissions } from './SharePermissions';
import { useIsAuthenticated } from '@core/auth';
import { toast } from './Toast/Toast';

interface ForwardToChannelProps {
  submitPermissionInfo?: {
    setChannelPermissions: (channelId: string, accessLevel: AccessLevel) => void;
    channelSharePermissions?: SharePermissionV2ChannelSharePermissions;
    userPermissions: Permissions;
  };
  onSubmit?: () => void;
  refetch?: () => void;
  projectId?: string;
  name: string;

}

export function ForwardToChannel(props: ForwardToChannelProps) {
  const isAuthenticated = useIsAuthenticated();
  const { track } = withAnalytics();

  const [selectedOptions, setSelectedOptions] = createSignal<WithCustomUserInput<'user' | 'contact' | 'channel'>[]>([]);
  const {focus: focusMarkdownArea, state: markdownState, MarkdownArea} = useChannelMarkdownArea();
  const [triedToSubmit, setTriedToSubmit] = createSignal(false);
  const { all: destinationOptions } = useCombinedRecipients();

  const destination = createMemo(() => {
    let options = selectedOptions();
    if(!options || options.length === 0){return};
    return getDestinationFromOptions(options);
  });

  const channelPermissions = createMemo(() => {
    if(!props.submitPermissionInfo){return};
    const destination_ = destination();
    if(!destination_ || destination_.type !== 'channel'){return};
    const perms = props.submitPermissionInfo.channelSharePermissions?.find((p) => p.channel_id === destination_.id);
    return perms;
  });

  const { sendToUsers, sendToChannel } = useSendMessageToPeople();
  const [submitAccessLevel, setSubmitAccessLevel] = createSignal<AccessLevel | null>(null);

  createEffect(() => {
    const channelPermissions_ = channelPermissions();
    if(channelPermissions_){setSubmitAccessLevel(channelPermissions_?.access_level)}
    else{setSubmitAccessLevel(['md'].includes(useBlockName()) ? 'edit' : 'view')}
  });

  const submitChannelPermissions = (channelId: string) => {
    if(!props.submitPermissionInfo){return};

    const accessLevel = submitAccessLevel();
    if(!accessLevel){
      toast.failure('Failed to set channel permissions');
      return;
    }

    props.submitPermissionInfo.setChannelPermissions(channelId, accessLevel);
  };

  const [sendAsGroupMessage, setSendAsGroupMessage] = createSignal<boolean>(true);

  const canSendAsGroup = createMemo(() => {
    const _selectedOptions = selectedOptions();
    if(!_selectedOptions || _selectedOptions.length <= 1){return false};
    for(const selectedOption of _selectedOptions){
      if(selectedOption.kind === 'channel'){return false};
    }
    return true;
  });

  const asAttachment = {
    entity_type: blockNameToItemType(useBlockAliasedName()) ?? 'unknown',
    entity_id: useBlockId(),
  };

  function handleSubmit() {
    let options = selectedOptions();
    if(!options || options.length === 0){return setTriedToSubmit(true)};

    if(canSendAsGroup() && sendAsGroupMessage()) {
      const destination_ = destination();
      if(destination_ && destination_.type === 'users'){
        sendToUsers({
          attachments: [asAttachment],
          users: destination_.users,
          content: markdownState(),
          mentions: [],
        })
        .then((res) => {
          if(!res){return};
          const{channelId, navigateToChannel} = res;
          submitChannelPermissions(channelId);

          props.refetch?.();
          toast.success('Message sent successfully', undefined, {
            onClick: navigateToChannel,
            text: 'View in channel'
          });
          track(TrackingEvents.SHARE.FORWARD);
        });
      }
      else{toast.failure('Message failed to send')}
    }
    else{
      const multipleMessages = options.length > 1;
      let successfullySentAllMessages = true;
      for(const option of options){
        if(option.kind === 'channel'){
          Promise.all([
            submitChannelPermissions(option.id),
            sendToChannel({
              attachments: [asAttachment],
              content: markdownState(),
              channelId: option.id,
              mentions: [],
            })
            .then((res) => {
              if(!res){
                successfullySentAllMessages = false;
                return;
              }
              props.refetch?.();
              if(!multipleMessages){
                const { navigateToChannel } = res;
                toast.success('Message sent successfully', undefined, {
                  onClick: () => navigateToChannel(),
                  text: 'View in channel',
                });
              }
              track(TrackingEvents.SHARE.FORWARD);
            }),
          ]);
        }
        else {
          // handles option.kind of user, custom, and contact (gmail)
          sendToUsers({
            attachments: [asAttachment],
            content: markdownState(),
            users: [option.id],
            mentions: [],
          })
          .then((res) => {
            if(!res){
              successfullySentAllMessages = false;
              return;
            }
            const { channelId, navigateToChannel } = res;
            submitChannelPermissions(channelId);

            props.refetch?.();
            if(!multipleMessages){
              toast.success('Message sent successfully', undefined, {
                onClick: () => navigateToChannel(),
                text: 'View in channel',
              });
            }
            track(TrackingEvents.SHARE.FORWARD);
          });
        }
      }
      if(multipleMessages){
        if(successfullySentAllMessages){toast.success('Messages sent successfully')}
        else{toast.failure('Some messages failed to send')}
      }
    }

    const destination_ = destination();
    if(!destination_){return};

    props.onSubmit?.();
  }

  return (
    <Show when={isAuthenticated()}>
      <div class="flex flex-col gap-1.5 p-0.5 w-full">
        <RecipientSelector<'user' | 'contact' | 'channel'>
          placeholder="To: enter emails or group name"
          setSelectedOptions={setSelectedOptions}
          selectedOptions={selectedOptions}
          triedToSubmit={triedToSubmit}
          options={destinationOptions}
          triggerMode="input"
        />
        <div class="flex flex-col bg-input shadow-[inset_0_2px_20px_rgba(0,0,0,0.015)] border border-edge w-full min-h-[60px] sm:min-h-[80px] max-h-[150px] overflow-y-auto">
          <div
            class="flex-1 px-2.5 py-1 w-full text-sm"
            onClick={() => focusMarkdownArea()}
          >
            <MarkdownArea
              placeholder="Add a message (optional)..."
              onEnter={(e: KeyboardEvent) => {
                handleSubmit();
                e.preventDefault();
                return true;
              }}
              initialValue={markdownState()}
              onTab={() => {return true}}
              useBlockBoundary={false}
              portalScope="local"
              dontFocusOnMount
            />
          </div>
        </div>
        <div class="flex flex-col">
          <div class={`mx-1.5 flex flex-row justify-between items-center align-middle h-fit ${canSendAsGroup() ? '' : 'opacity-50'}`}>
            <div class="flex flex-col gap-0.5">
              <div class="font-sm text-ink-muted text-xs select-none">
                {'Send as group message'}
              </div>
            </div>

            <KobalteSwitch
              checked={sendAsGroupMessage() && canSendAsGroup()}
              onChange={setSendAsGroupMessage}
              disabled={!canSendAsGroup()}
              class={canSendAsGroup() ? '' : 'cursor-not-allowed'}
            >
              <KobalteSwitch.Input
                disabled={!canSendAsGroup()}
                class="sr-only"
              />
              <KobalteSwitch.Control
                class={`mt-1.5 inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors bg-edge data-[checked]:bg-accent
                ${canSendAsGroup() ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2' : ''}`}
              >
                <KobalteSwitch.Thumb class="block bg-dialog rounded-full w-4 h-4 transition-transform data-[checked]:translate-x-4" />
              </KobalteSwitch.Control>
            </KobalteSwitch>
          </div>
          <div class="flex justify-between items-center gap-1 mt-1">
            <div class="flex flex-row justify-start items-center gap-0 w-full h-8 cursor-default">
              <button
                class="flex flex-row justify-center items-center bg-accent/80 hover:bg-accent active:bg-accent px-2 rounded-lg w-full h-full font-semibold text-dialog text-sm leading-5 whitespace-nowrap gap-2"
                onClick={handleSubmit}
              >
                <PaperPlaneRight class="flex w-4 h-4" />
                {'Share and send message'}
              </button>
            </div>
            <Show when={props.submitPermissionInfo?.userPermissions === Permissions.OWNER}>
              <div class="w-32">
                <ShareOptions
                  setPermissions={(accessLevel) => {setSubmitAccessLevel(accessLevel)}}
                  permissions={submitAccessLevel()}
                  hideNoAccess
                />
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
