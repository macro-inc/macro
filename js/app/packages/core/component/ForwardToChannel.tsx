import { useChannelMarkdownArea } from '@block-channel/component/MarkdownArea';
import { withAnalytics } from '@coparse/analytics';
import { TrackingEvents } from '@coparse/analytics/src/types/TrackingEvents';
import { useIsAuthenticated } from '@core/auth';
import { useBlockAliasedName, useBlockId, useBlockName } from '@core/block';
import { ToggleSwitch } from '@core/component/FormControls/ToggleSwitch';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { TextButton } from '@core/component/TextButton';
import { ShareOptions } from '@core/component/TopBar/ShareButton';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import type { WithCustomUserInput } from '@core/user';
import { useSendMessageToPeople } from '@core/util/channels';
import PaperPlaneRight from '@phosphor-icons/core/fill/paper-plane-right-fill.svg?component-solid';
import { blockNameToItemType } from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { SharePermissionV2ChannelSharePermissions } from '@service-storage/generated/schemas/sharePermissionV2ChannelSharePermissions';
import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import { getDestinationFromOptions } from './NewMessage';
import { Permissions } from './SharePermissions';
import { toast } from './Toast/Toast';

interface ForwardToChannelProps {
  submitPermissionInfo?: {
    setChannelPermissions: (
      channelId: string,
      accessLevel: AccessLevel
    ) => void;
    channelSharePermissions?: SharePermissionV2ChannelSharePermissions;
    userPermissions: Permissions;
  };
  onSubmit?: () => void;
  refetch?: () => void;
  projectId?: string;
  name?: string;
}

export function ForwardToChannel(props: ForwardToChannelProps) {
  const isAuthenticated = useIsAuthenticated();
  const { track } = withAnalytics();

  const [selectedOptions, setSelectedOptions] = createSignal<
    WithCustomUserInput<'user' | 'contact' | 'channel'>[]
  >([]);
  const {
    focus: focusMarkdownArea,
    state: markdownState,
    MarkdownArea,
  } = useChannelMarkdownArea();
  const [triedToSubmit, setTriedToSubmit] = createSignal(false);
  const { all: destinationOptions } = useCombinedRecipients();

  const destination = createMemo(() => {
    let options = selectedOptions();
    if (!options || options.length === 0) {
      return;
    }
    return getDestinationFromOptions(options);
  });

  const channelPermissions = createMemo(() => {
    if (!props.submitPermissionInfo) {
      return;
    }
    const destination_ = destination();
    if (!destination_ || destination_.type !== 'channel') {
      return;
    }
    const perms = props.submitPermissionInfo.channelSharePermissions?.find(
      (p) => p.channel_id === destination_.id
    );
    return perms;
  });

  const { sendToUsers, sendToChannel } = useSendMessageToPeople();
  const [submitAccessLevel, setSubmitAccessLevel] =
    createSignal<AccessLevel | null>(null);

  createEffect(() => {
    const channelPermissions_ = channelPermissions();
    if (channelPermissions_) {
      setSubmitAccessLevel(channelPermissions_?.access_level);
    } else {
      setSubmitAccessLevel(['md'].includes(useBlockName()) ? 'edit' : 'view');
    }
  });

  const submitChannelPermissions = (channelId: string) => {
    if (!props.submitPermissionInfo) {
      return;
    }

    const accessLevel = submitAccessLevel();
    if (!accessLevel) {
      toast.failure('Failed to set channel permissions');
      return;
    }

    props.submitPermissionInfo.setChannelPermissions(channelId, accessLevel);
  };

  const [sendAsGroupMessage, setSendAsGroupMessage] =
    createSignal<boolean>(true);

  const canSendAsGroup = createMemo(() => {
    const _selectedOptions = selectedOptions();
    if (!_selectedOptions || _selectedOptions.length <= 1) {
      return false;
    }
    for (const selectedOption of _selectedOptions) {
      if (selectedOption.kind === 'channel') {
        return false;
      }
    }
    return true;
  });

  const asAttachment = {
    entity_type: blockNameToItemType(useBlockAliasedName()) ?? 'unknown',
    entity_id: useBlockId(),
  };

  function handleSubmit() {
    let options = selectedOptions();
    if (!options || options.length === 0) {
      return setTriedToSubmit(true);
    }

    if (canSendAsGroup() && sendAsGroupMessage()) {
      const destination_ = destination();
      if (destination_ && destination_.type === 'users') {
        sendToUsers({
          attachments: [asAttachment],
          users: destination_.users,
          content: markdownState(),
          mentions: [],
        }).then((res) => {
          if (!res) {
            return;
          }
          const { channelId, navigateToChannel } = res;
          submitChannelPermissions(channelId);

          props.refetch?.();
          toast.success('Message sent successfully', undefined, {
            onClick: navigateToChannel,
            text: 'View in channel',
          });
          track(TrackingEvents.SHARE.FORWARD);
        });
      } else {
        toast.failure('Message failed to send');
      }
    } else {
      const multipleMessages = options.length > 1;
      let successfullySentAllMessages = true;
      for (const option of options) {
        if (option.kind === 'channel') {
          Promise.all([
            submitChannelPermissions(option.id),
            sendToChannel({
              attachments: [asAttachment],
              content: markdownState(),
              channelId: option.id,
              mentions: [],
            }).then((res) => {
              if (!res) {
                successfullySentAllMessages = false;
                return;
              }
              props.refetch?.();
              if (!multipleMessages) {
                const { navigateToChannel } = res;
                toast.success('Message sent successfully', undefined, {
                  onClick: () => navigateToChannel(),
                  text: 'View in channel',
                });
              }
              track(TrackingEvents.SHARE.FORWARD);
            }),
          ]);
        } else {
          // handles option.kind of user, custom, and contact (gmail)
          sendToUsers({
            attachments: [asAttachment],
            content: markdownState(),
            users: [option.id],
            mentions: [],
          }).then((res) => {
            if (!res) {
              successfullySentAllMessages = false;
              return;
            }
            const { channelId, navigateToChannel } = res;
            submitChannelPermissions(channelId);

            props.refetch?.();
            if (!multipleMessages) {
              toast.success('Message sent successfully', undefined, {
                onClick: () => navigateToChannel(),
                text: 'View in channel',
              });
            }
            track(TrackingEvents.SHARE.FORWARD);
          });
        }
      }
      if (multipleMessages) {
        if (successfullySentAllMessages) {
          toast.success('Messages sent successfully');
        } else {
          toast.failure('Some messages failed to send');
        }
      }
    }

    const destination_ = destination();
    if (!destination_) {
      return;
    }

    props.onSubmit?.();
  }

  return (
    <Show when={isAuthenticated()}>
      <div class="flex flex-col w-full">
        <div class="p-2">
          <RecipientSelector<'user' | 'contact' | 'channel'>
            placeholder="To: Email Or Group"
            setSelectedOptions={setSelectedOptions}
            selectedOptions={selectedOptions}
            triedToSubmit={triedToSubmit}
            options={destinationOptions}
            triggerMode="input"
            noBrackets
            hideBorder
            noPadding
          />
        </div>
        <div class="flex flex-col w-full h-[120px] overflow-y-auto border-t-1 border-edge-muted/50">
          <div
            class="flex-1 px-[12px] py-[6px] w-full text-sm"
            onClick={() => focusMarkdownArea()}
          >
            <MarkdownArea
              placeholder="Optional: Message"
              onEnter={(e: KeyboardEvent) => {
                handleSubmit();
                e.preventDefault();
                return true;
              }}
              initialValue={markdownState()}
              onTab={() => {
                return true;
              }}
              useBlockBoundary={false}
              portalScope="local"
              dontFocusOnMount
            />
          </div>

          <div class="flex w-full items-center pl-3">
            <div class="w-min">
              <Show when={canSendAsGroup()}>
                <ToggleSwitch
                  switchRootClass={canSendAsGroup() ? '' : 'cursor-not-allowed'}
                  checked={sendAsGroupMessage() && canSendAsGroup()}
                  onChange={setSendAsGroupMessage}
                  disabled={!canSendAsGroup()}
                  label={'Send In Channel'}
                  falseLabel="FALSE"
                  trueLabel="TRUE"
                  size="SM"
                />
              </Show>
            </div>

            <div class="w-full p-2 gap-2 flex justify-end">
              <TextButton
                onClick={() => {
                  const options = selectedOptions();
                  if (options && options.length > 0) {
                    handleSubmit();
                  }
                }}
                theme={selectedOptions().length > 0 ? 'accent' : 'disabled'}
                icon={PaperPlaneRight}
                height="h-[22px]"
                text="Share"
              />

              <Show
                when={
                  props.submitPermissionInfo?.userPermissions ===
                  Permissions.OWNER
                }
              >
                <ShareOptions
                  setPermissions={(accessLevel) => {
                    setSubmitAccessLevel(accessLevel);
                  }}
                  permissions={submitAccessLevel()}
                  label="Permission"
                  hideNoAccess
                />
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
