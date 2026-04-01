import { useChannelMarkdownArea } from '@block-channel/component/MarkdownArea';
import { useAnalytics } from '@app/component/analytics-context';
import { useIsAuthenticated } from '@core/auth';
import {
  useMaybeBlockAliasedName,
  useMaybeBlockId,
  useMaybeBlockName,
  type BlockName,
  type BlockAlias,
} from '@core/block';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { ShareOptions } from '@core/component/TopBar/ShareButton';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import type { WithCustomUserInput } from '@core/user';
import { useSendMessageToPeople } from '@core/util/channels';
import CheckIcon from '@icon/bold/check-bold.svg?component-solid';
import PaperPlane from '@macro-icons/wide/paper-plane-cutout.svg';
import { blockNameToItemType } from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { SharePermissionV2ChannelSharePermissions } from '@service-storage/generated/schemas/sharePermissionV2ChannelSharePermissions';
import {
  createEffect,
  createMemo,
  createSignal,
  onMount,
  Show,
} from 'solid-js';
import { Button } from '@ui/components/Button';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { getDestinationFromOptions } from './NewMessage';
import { Permissions } from './SharePermissions';
import { toast } from './Toast/Toast';
import { ScrollIndicators } from './VerticalScrollIndicators';

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
  onCancel?: () => void;
  refetch?: () => void;
  projectId?: string;
  name: string;
  ref?: (ref: {
    getSelectedOptions: () => WithCustomUserInput<
      'user' | 'contact' | 'channel'
    >[];
    setSubmitAccessLevel: (level: AccessLevel | null) => void;
    getSubmitAccessLevel: () => AccessLevel | null;
    handleSubmit: () => void;
  }) => void;
  hideAccessLevelSelector?: boolean;
  initialAccessLevel?: AccessLevel | null;
  blockId?: string;
  blockName?: BlockName | BlockAlias;
}

export function ForwardToChannel(props: ForwardToChannelProps) {
  const isAuthenticated = useIsAuthenticated();
  const analytics = useAnalytics();

  const [selectedOptions, setSelectedOptions] = createSignal<
    WithCustomUserInput<'user' | 'contact' | 'channel'>[]
  >([]);

  const [mdScrollRef, setMdScrollRef] = createSignal<HTMLElement>();

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
  const blockBaseName = useMaybeBlockName() ?? props.blockName;
  const [submitAccessLevel, setSubmitAccessLevel] =
    createSignal<AccessLevel | null>(
      props.initialAccessLevel ?? (blockBaseName === 'md' ? 'edit' : 'view')
    );
  createEffect(() => {
    const channelPermissions_ = channelPermissions();
    if (channelPermissions_) {
      setSubmitAccessLevel(channelPermissions_.access_level);
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

  const blockName = useMaybeBlockAliasedName() ?? props.blockName;
  const blockId = useMaybeBlockId() ?? props.blockId;
  const asAttachment = () => {
    const itemType =
      blockName === 'email'
        ? 'thread'
        : blockName != null
          ? blockNameToItemType(blockName)
          : undefined;
    return {
      entity_type: itemType ?? 'unknown',
      entity_id: blockId ?? '',
    };
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
          attachments: [asAttachment()],
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
          toast.success('Message sent successfully', undefined, [
            {
              label: 'View in channel',
              onClick: navigateToChannel,
            },
          ]);
          analytics.track('share_entity', { location: 'forward_to_channel' });
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
              attachments: [asAttachment()],
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
                toast.success('Message sent successfully', undefined, [
                  {
                    label: 'View in channel',
                    onClick: () => navigateToChannel(),
                  },
                ]);
              }
              analytics.track('share_entity', {
                location: 'forward_to_channel',
              });
            }),
          ]);
        } else {
          // handles option.kind of user, custom, and contact (gmail)
          sendToUsers({
            attachments: [asAttachment()],
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
              toast.success('Message sent successfully', undefined, [
                {
                  label: 'View in channel',
                  onClick: () => navigateToChannel(),
                },
              ]);
            }
            analytics.track('share_entity', { location: 'forward_to_channel' });
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

  onMount(() => {
    if (props.ref) {
      props.ref({
        getSubmitAccessLevel: submitAccessLevel,
        getSelectedOptions: selectedOptions,
        setSubmitAccessLevel,
        handleSubmit,
      });
    }
  });

  return (
    <Show when={isAuthenticated()}>
      {/* Row 1: Recipient input + ShareOptions */}
      <div class="flex items-center">
        <div class="min-w-0 flex-1 px-1 py-2 min-h-11">
          <RecipientSelector<'user' | 'contact' | 'channel'>
            placeholder="To: Email or group"
            setSelectedOptions={setSelectedOptions}
            selectedOptions={selectedOptions()}
            triedToSubmit={triedToSubmit}
            options={destinationOptions}
            triggerMode="input"
            noBrackets
            hideBorder
            noPadding
            focusOnMount
            mobileHorizontalScroll
          />
        </div>
        <Show
          when={
            props.submitPermissionInfo?.userPermissions === Permissions.OWNER &&
            !props.hideAccessLevelSelector
          }
        >
          <div class="shrink-0 pr-2 flex items-center">
            <Show when={selectedOptions().length > 0}>
              <span class="text-sm text-ink-muted pr-2">can</span>
            </Show>
            <ShareOptions
              setPermissions={(accessLevel) =>
                setSubmitAccessLevel(accessLevel)
              }
              permissions={submitAccessLevel()}
              label="Permission"
              hideNoAccess
              noBorder
            />
          </div>
        </Show>
      </div>

      {/* Row 2: Optional message */}
      <div class="grow-1 shrink-1 min-h-0 flex flex-col w-full border-t-1 border-edge-muted/50">
        <div class="relative grow-1 shrink-1 min-h-0 flex flex-col">
          <ScrollIndicators scrollRef={mdScrollRef} noBorderStart />
          <CustomScrollbar scrollContainer={mdScrollRef} />
          <div
            class="grow-1 shrink-1 min-h-20 max-h-40 overflow-y-auto scrollbar-hidden px-[12px] py-[6px] w-full text-sm"
            onClick={() => focusMarkdownArea()}
            ref={setMdScrollRef}
          >
            <MarkdownArea
              placeholder="Optional message"
              onEnter={(e: KeyboardEvent) => {
                handleSubmit();
                e.preventDefault();
                return true;
              }}
              initialValue={markdownState()}
              onTab={() => false}
              useBlockBoundary={false}
              portalScope="local"
              dontFocusOnMount
            />
          </div>
        </div>

        {/* Row 3: Send As Group (optional) + Cancel + Send */}
        <div class="shrink-0 flex w-full items-center p-3 gap-3 flex-wrap">
          <Show when={canSendAsGroup()}>
            <label
              class={`flex items-start gap-2 ${!canSendAsGroup() ? 'cursor-not-allowed' : 'cursor-default'}`}
            >
              <div class="relative mt-0.5">
                <input
                  onChange={(e) =>
                    setSendAsGroupMessage(e.currentTarget.checked)
                  }
                  checked={sendAsGroupMessage() && canSendAsGroup()}
                  disabled={!canSendAsGroup()}
                  class="peer sr-only"
                  type="checkbox"
                />
                <div
                  class={`w-4 h-4 border ${
                    !canSendAsGroup()
                      ? 'border-edge/30 peer-checked:bg-menu/20'
                      : 'border-edge hover:border-accent/30 peer-checked:bg-accent/10 peer-checked:border-accent/30'
                  }`}
                >
                  <Show when={sendAsGroupMessage() && canSendAsGroup()}>
                    <CheckIcon class="w-full h-full text-accent p-0.5" />
                  </Show>
                </div>
              </div>
              <div
                class={`flex flex-col text-sm ${!canSendAsGroup() ? 'text-ink-disabled/50' : ''}`}
              >
                <span class="font-medium">Send As Group Message</span>
                <span
                  class={`text-xs mt-0.5 ${!canSendAsGroup() ? 'text-ink-disabled/50' : 'text-ink-muted'}`}
                >
                  {sendAsGroupMessage() && canSendAsGroup()
                    ? 'Creates a new group message with all recipients'
                    : 'Send a message to each recipient'}
                </span>
              </div>
            </label>
          </Show>

          <div class="flex flex-auto items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => props.onCancel?.()}
            >
              Cancel
            </Button>
            <Button
              variant={selectedOptions().length > 0 ? 'accent' : 'secondary'}
              size="sm"
              class="pl-2 pr-2 rounded-xs flex items-center gap-1"
              disabled={selectedOptions().length === 0}
              onClick={() => {
                const options = selectedOptions();
                if (options && options.length > 0) {
                  handleSubmit();
                }
              }}
            >
              <PaperPlane class="size-4" />
              Share
            </Button>
          </div>
        </div>
      </div>
    </Show>
  );
}
