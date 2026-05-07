import { useAnalytics } from '@app/component/analytics-context';
import { createConfiguredChannelMarkdownEditor } from '@channel/Input';
import { useIsAuthenticated } from '@core/auth';
import {
  type BlockAlias,
  type BlockName,
  useMaybeBlockAliasedName,
  useMaybeBlockId,
  useMaybeBlockName,
} from '@core/block';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { ShareOptions } from '@core/component/TopBar/ShareButton';
import { isMobile } from '@core/mobile/isMobile';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import type { WithCustomUserInput } from '@core/user';
import { useSendMessageToPeople } from '@core/util/channels';
import { getDestinationFromOptions } from '@core/util/destination';
import CheckIcon from '@icon/bold/check-bold.svg?component-solid';
import PaperPlane from '@macro-icons/wide/paper-plane-cutout.svg';
import { blockNameToItemType } from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { SharePermissionV2ChannelSharePermissions } from '@service-storage/generated/schemas/sharePermissionV2ChannelSharePermissions';
import { Button, cn } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onMount,
  Show,
} from 'solid-js';
import { Permissions } from './SharePermissions';
import { toast } from './Toast/Toast';
import { ScrollIndicators } from './VerticalScrollIndicators';

type Recipient = WithCustomUserInput<'user' | 'contact' | 'channel'>;

interface MobileForwardToChannelLayoutProps
  extends Pick<
    ForwardToChannelProps,
    'submitPermissionInfo' | 'hideAccessLevelSelector'
  > {
  isAuthenticated: Accessor<boolean | undefined>;
  selectedOptions: Accessor<Recipient[]>;
  setSelectedOptions: (v: Recipient[]) => void;
  triedToSubmit: Accessor<boolean>;
  destinationOptions: ReturnType<typeof useCombinedRecipients>['all'];
  submitAccessLevel: Accessor<AccessLevel | null>;
  setSubmitAccessLevel: (level: AccessLevel | null) => void;
  mdScrollRef: Accessor<HTMLElement | undefined>;
  setMdScrollRef: (el: HTMLElement) => void;
  markdownEditor: ReturnType<typeof createConfiguredChannelMarkdownEditor>;
  handleSubmit: () => void;
  canSendAsGroup: Accessor<boolean>;
  sendAsGroupMessage: Accessor<boolean>;
  setSendAsGroupMessage: (v: boolean) => void;
}

function MobileForwardToChannelLayout(
  props: MobileForwardToChannelLayoutProps
) {
  return (
    <Show when={props.isAuthenticated()}>
      <div class="px-3 py-2 min-h-11" data-share-drawer-recipient>
        <RecipientSelector<'user' | 'contact' | 'channel'>
          placeholder="To: Email or group"
          setSelectedOptions={props.setSelectedOptions}
          selectedOptions={props.selectedOptions()}
          triedToSubmit={props.triedToSubmit}
          options={props.destinationOptions}
          triggerMode="input"
          class="border border-edge-muted p-1"
          focusOnMount
        />
      </div>
      {/* Send as group */}
      <Show when={props.canSendAsGroup()}>
        <div class="shrink-0 flex w-full items-center p-3 gap-3 flex-wrap">
          <label
            class={`flex items-start gap-2 ${!props.canSendAsGroup() ? 'cursor-not-allowed' : 'cursor-default'}`}
          >
            <div class="relative mt-0.5">
              <input
                onChange={(e) =>
                  props.setSendAsGroupMessage(e.currentTarget.checked)
                }
                checked={props.sendAsGroupMessage() && props.canSendAsGroup()}
                disabled={!props.canSendAsGroup()}
                class="peer sr-only"
                type="checkbox"
              />
              <div
                class={`size-4 border ${
                  !props.canSendAsGroup()
                    ? 'border-edge peer-checked:bg-menu/20'
                    : 'border-edge hover:border-accent/30 peer-checked:bg-accent/10 peer-checked:border-accent/30'
                }`}
              >
                <Show
                  when={props.sendAsGroupMessage() && props.canSendAsGroup()}
                >
                  <CheckIcon class="size-full text-accent p-0.5" />
                </Show>
              </div>
            </div>
            <div
              class={`flex flex-col text-sm ${!props.canSendAsGroup() ? 'text-ink-disabled/50' : ''}`}
            >
              <span class="font-medium">Send As Group Message</span>
              <span
                class={`text-xs mt-0.5 ${!props.canSendAsGroup() ? 'text-ink-disabled/50' : 'text-ink-muted'}`}
              >
                {props.sendAsGroupMessage() && props.canSendAsGroup()
                  ? 'Creates a new group message with all recipients'
                  : 'Send a message to each recipient'}
              </span>
            </div>
          </label>
        </div>
      </Show>
      <Show
        when={
          props.submitPermissionInfo?.userPermissions === Permissions.OWNER &&
          !props.hideAccessLevelSelector
        }
      >
        <div class="px-3 py-2 flex items-center">
          <span class="text-sm text-ink-muted pr-2">Access:</span>
          <ShareOptions
            setPermissions={(accessLevel) =>
              props.setSubmitAccessLevel(accessLevel)
            }
            permissions={props.submitAccessLevel()}
            label="Permission"
            hideNoAccess
          />
        </div>
      </Show>

      <div class="flex-1 min-h-20 flex flex-col w-full mt-3 border-t border-edge-muted relative">
        <ScrollIndicators scrollRef={props.mdScrollRef} noBorderStart />
        <CustomScrollbar scrollContainer={props.mdScrollRef} />
        <div
          class="grow shrink min-h-20 overflow-y-auto scrollbar-hidden px-3 py-1.5 w-full text-sm"
          onClick={() => props.markdownEditor.controls.focus()}
          ref={props.setMdScrollRef}
        >
          <MarkdownShell
            config={props.markdownEditor}
            placeholder="Optional message"
            portalScope="local"
            class="text-sm"
          />
        </div>
      </div>
    </Show>
  );
}

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

  const [markdown, setMarkdown] = createSignal('');
  const markdownEditor = createConfiguredChannelMarkdownEditor({
    namespace: 'forward-to-channel-markdown',
    enableMentions: true,
    onChange: setMarkdown,
    onEnter: (e) => {
      handleSubmit();
      e.preventDefault();
      return true;
    },
  });
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
          content: markdown(),
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
              content: markdown(),
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
            content: markdown(),
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
    <Show
      when={!isMobile()}
      fallback={
        <MobileForwardToChannelLayout
          isAuthenticated={isAuthenticated}
          selectedOptions={selectedOptions}
          setSelectedOptions={(v) => setSelectedOptions(v)}
          triedToSubmit={triedToSubmit}
          destinationOptions={destinationOptions}
          submitPermissionInfo={props.submitPermissionInfo}
          hideAccessLevelSelector={props.hideAccessLevelSelector}
          submitAccessLevel={submitAccessLevel}
          setSubmitAccessLevel={setSubmitAccessLevel}
          mdScrollRef={mdScrollRef}
          setMdScrollRef={setMdScrollRef}
          markdownEditor={markdownEditor}
          handleSubmit={handleSubmit}
          canSendAsGroup={canSendAsGroup}
          sendAsGroupMessage={sendAsGroupMessage}
          setSendAsGroupMessage={setSendAsGroupMessage}
        />
      }
    >
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
              class="border border-edge-muted p-1"
              focusOnMount
              horizontalScroll
            />
          </div>
          <Show
            when={
              props.submitPermissionInfo?.userPermissions ===
                Permissions.OWNER && !props.hideAccessLevelSelector
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
        <div class="grow shrink min-h-0 flex flex-col w-full border-t border-edge-muted">
          <div class="relative grow shrink min-h-0 flex flex-col">
            <ScrollIndicators scrollRef={mdScrollRef} noBorderStart />
            <CustomScrollbar scrollContainer={mdScrollRef} />
            <div
              class="grow shrink min-h-20 max-h-40 overflow-y-auto scrollbar-hidden px-3 py-1.5 w-full text-sm"
              onClick={() => markdownEditor.controls.focus()}
              ref={setMdScrollRef}
            >
              <MarkdownShell
                config={markdownEditor}
                placeholder="Optional message"
                portalScope="local"
                class="text-sm"
              />
            </div>
          </div>

          {/* Row 3: Send As Group (optional) + Cancel + Send */}
          <div class="shrink-0 flex w-full items-center p-3 gap-3 flex-wrap">
            <Show when={canSendAsGroup()}>
              <label
                class={cn(
                  'flex items-start gap-2',
                  !canSendAsGroup() ? 'cursor-not-allowed' : 'cursor-default'
                )}
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
                    class={cn(
                      'size-4 border',
                      !canSendAsGroup()
                        ? 'border-edge peer-checked:bg-menu/20'
                        : 'border-edge hover:border-accent/30 peer-checked:bg-accent/10 peer-checked:border-accent/30'
                    )}
                  >
                    <Show when={sendAsGroupMessage() && canSendAsGroup()}>
                      <CheckIcon class="size-full text-accent p-0.5" />
                    </Show>
                  </div>
                </div>
                <div
                  class={cn(
                    'flex flex-col text-sm',
                    !canSendAsGroup() && 'text-ink-disabled/50'
                  )}
                >
                  <span class="font-medium">Send As Group Message</span>
                  <span
                    class={cn(
                      'text-xs mt-0.5',
                      !canSendAsGroup()
                        ? 'text-ink-disabled/50'
                        : 'text-ink-muted'
                    )}
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
                variant={selectedOptions().length > 0 ? 'active' : 'base'}
                size="sm"
                class="px-2 rounded-xs flex items-center gap-1"
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
    </Show>
  );
}
