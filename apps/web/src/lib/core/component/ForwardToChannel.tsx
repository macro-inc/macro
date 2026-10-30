import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { useIsAuthenticated } from '@core/auth';
import {
  type BlockAlias,
  type BlockName,
  useMaybeBlockAliasedName,
  useMaybeBlockId,
  useMaybeBlockName,
} from '@core/block';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { ShareOptions } from '@core/component/TopBar/ShareButton';
import { resolveBlockAlias } from '@core/constant/allBlocks';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isMobile } from '@core/mobile/isMobile';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import type { WithCustomUserInput } from '@core/user';
import { useSendMessageToPeople } from '@core/util/channels';
import { getDestinationFromOptions } from '@core/util/destination';
import { fireAndForget } from '@core/util/fireAndForget';
import { chatRuleset, uploadFile } from '@core/util/upload';
import CheckIcon from '@icon/system/regular/check.svg?component-solid';
import PaperPlaneTilt from '@icon/system/regular/paper-plane-tilt.svg';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  blockNameToItemType,
  itemTypeToReferenceEntityType,
} from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { NewAttachment } from '@service-storage/generated/schemas/newAttachment';
import type { SharePermissionV2ChannelSharePermissions } from '@service-storage/generated/schemas/sharePermissionV2ChannelSharePermissions';
import { Button, cn, Hotkey } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onMount,
  Show,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  createForwardMessageComposer,
  ForwardMessageComposer,
} from './ForwardMessageComposer';
import { Permissions } from './SharePermissions';
import { toast } from './Toast/Toast';

type Recipient = WithCustomUserInput<'user' | 'contact' | 'channel'>;

interface MobileForwardToChannelLayoutProps
  extends Pick<
    ForwardToChannelProps,
    | 'submitPermissionInfo'
    | 'hideAccessLevelSelector'
    | 'editPermissionEnabled'
    | 'allowedAccessLevels'
  > {
  isAuthenticated: Accessor<boolean | undefined>;
  selectedOptions: Accessor<Recipient[]>;
  setSelectedOptions: (v: Recipient[]) => void;
  triedToSubmit: Accessor<boolean>;
  destinationOptions: ReturnType<typeof useCombinedRecipients>['all'];
  submitAccessLevel: Accessor<AccessLevel | null>;
  setSubmitAccessLevel: (level: AccessLevel | null) => void;
  composer: ReturnType<typeof createForwardMessageComposer>;
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
                    ? 'border-edge peer-checked:bg-surface/20'
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
            editPermissionEnabled={props.editPermissionEnabled}
            allowedAccessLevels={props.allowedAccessLevels}
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
        <ForwardMessageComposer composer={props.composer} />
      </div>
    </Show>
  );
}

interface ForwardToChannelProps {
  editPermissionEnabled?: boolean;
  submitPermissionInfo?: {
    setChannelPermissions: (
      channelId: string,
      accessLevel: AccessLevel
    ) => void | boolean | Promise<void | boolean>;
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
    canSubmit: () => boolean;
  }) => void;
  hideAccessLevelSelector?: boolean;
  initialAccessLevel?: AccessLevel | null;
  /** Levels the picker offers; all when absent. */
  allowedAccessLevels?: readonly AccessLevel[];
  /** Attach an entity that has no block, instead of `blockId`/`blockName`. */
  entity?: NewAttachment;
  /**
   * Grant the destination before the message is sent, for entities that
   * sending does not grant. Rejecting cancels that delivery.
   */
  prepareChannel?: (
    channelId: string,
    accessLevel: AccessLevel | null
  ) => Promise<void>;
  blockId?: string;
  blockName?: BlockName | BlockAlias;
}

export function ForwardToChannel(props: ForwardToChannelProps) {
  const isAuthenticated = useIsAuthenticated();
  const analytics = useAnalytics();

  const [selectedOptions, setSelectedOptions] = createSignal<
    WithCustomUserInput<'user' | 'contact' | 'channel'>[]
  >([]);

  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();

  const [triedToSubmit, setTriedToSubmit] = createSignal(false);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const composer = createForwardMessageComposer({
    resolveAppLink: useMacroMentionLinkResolver(),
    isSending: isSubmitting,
    uploadFile: (file) =>
      uploadFile(file, chatRuleset, { hideProgressIndicator: true }),
  });
  const canSubmit = () =>
    selectedOptions().length > 0 && !isSubmitting() && !composer.isUploading();
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
  const contextBlockBaseName = useMaybeBlockName();
  const blockBaseName = props.entity
    ? undefined
    : props.blockName
      ? resolveBlockAlias(props.blockName)
      : contextBlockBaseName;
  const [submitAccessLevel, setSubmitAccessLevel] =
    createSignal<AccessLevel | null>(
      props.initialAccessLevel ??
        match(blockBaseName)
          .returnType<AccessLevel>()
          .with('md', () => 'edit')
          .with('pdf', () => 'comment')
          .otherwise(() => 'view')
    );
  createEffect(() => {
    const channelPermissions_ = channelPermissions();
    if (channelPermissions_) {
      setSubmitAccessLevel(channelPermissions_.access_level);
    }
  });

  const submitChannelPermissions = async (
    channelId: string,
    accessLevel: AccessLevel | null
  ) => {
    if (!props.submitPermissionInfo) {
      return true;
    }

    if (!accessLevel) {
      toast.failure('Failed to set channel permissions');
      return false;
    }

    try {
      if (props.prepareChannel) {
        await props.prepareChannel(channelId, accessLevel);
        return true;
      }
      const result = await props.submitPermissionInfo.setChannelPermissions(
        channelId,
        accessLevel
      );
      return result !== false;
    } catch (error) {
      console.error('Failed to set channel permissions', error);
      toast.failure('Failed to set channel permissions');
      return false;
    }
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

  const contextBlockName = useMaybeBlockAliasedName();
  const contextBlockId = useMaybeBlockId();
  // Explicit identity can differ from the enclosing block (e.g. a newly
  // persisted agent session still mounted in its launcher placeholder).
  const blockName = () => props.blockName ?? contextBlockName;
  const blockId = () => props.blockId ?? contextBlockId;
  const itemType = () => {
    if (props.entity) return;
    const name = blockName();
    return name != null ? blockNameToItemType(name) : undefined;
  };

  const asAttachment = (): NewAttachment => {
    if (props.entity) return props.entity;
    const type = itemType();
    return {
      entity_type: type ? itemTypeToReferenceEntityType(type) : 'unknown',
      entity_id: blockId() ?? '',
    };
  };

  const trackForwardShare = (targetType: 'channel' | 'user') => {
    const attachment = asAttachment();
    analytics.track('share_entity', {
      entityType: itemType() ?? attachment.entity_type,
      entityId: attachment.entity_id || undefined,
      shareMethod: 'forward',
      targetType,
      location: 'forward_to_channel',
    });
  };

  // Keep confirmed deliveries until the whole share succeeds. Retrying a
  // failed grant must not send the same message to that recipient again.
  const deliveries = new Map<
    string,
    {
      result: NonNullable<Awaited<ReturnType<typeof sendToChannel>>>;
      accessLevel?: AccessLevel | null;
    }
  >();

  async function sendForward(
    target: NonNullable<ReturnType<typeof destination>>,
    accessLevel: AccessLevel | null,
    deliverySpan: Span
  ) {
    const prepare = props.prepareChannel;
    const composed = composer.message();
    const message = {
      ...composed,
      attachments: [asAttachment(), ...(composed.attachments ?? [])],
      beforeSend:
        prepare &&
        ((id: string) =>
          deliverySpan.span('share.update_permissions', async (span) => {
            span.setAttr('channel.id', id);
            try {
              await prepare(id, accessLevel);
            } catch (error) {
              span.error('Share permission update failed');
              throw error;
            }
          })),
    };
    const deliveryKey = JSON.stringify([
      message,
      target.type === 'channel'
        ? target
        : { type: target.type, users: [...target.users].sort() },
    ]);
    let delivery = deliveries.get(deliveryKey);
    deliverySpan.setAttr('delivery.reused', delivery !== undefined);
    if (!delivery) {
      const sendSpan = deliverySpan.span('share.send_message');
      let result;
      try {
        result = await sendSpan.run(() =>
          target.type === 'channel'
            ? sendToChannel({ ...message, channelId: target.id })
            : sendToUsers({ ...message, users: target.users })
        );
        if (result) sendSpan.setAttr('channel.id', result.channelId);
        else sendSpan.error('Share message send failed');
      } catch (error) {
        sendSpan.error('Share message send failed');
        console.error('Failed to forward message', error);
      } finally {
        sendSpan.end();
      }
      if (!result) {
        toast.failure('Message failed to send');
        return;
      }
      // A prepared destination was granted this level before sending.
      delivery = prepare ? { result, accessLevel } : { result };
      deliveries.set(deliveryKey, delivery);
      if (prepare) {
        trackForwardShare(target.type === 'channel' ? 'channel' : 'user');
      }
    }
    deliverySpan.setAttr('channel.id', delivery.result.channelId);

    // Sending an attachment can automatically grant access. Apply the selected
    // level afterward so that auto-grant cannot overwrite the user's choice.
    if (delivery.accessLevel !== accessLevel) {
      const channelId = delivery.result.channelId;
      const granted = await deliverySpan.span(
        'share.update_permissions',
        async (span) => {
          span.setAttr('channel.id', channelId);
          const result = await submitChannelPermissions(channelId, accessLevel);
          if (!result) span.error('Share permission update failed');
          return result;
        }
      );
      if (!granted) return;
      if (delivery.accessLevel === undefined) {
        trackForwardShare(target.type === 'channel' ? 'channel' : 'user');
      }
      delivery.accessLevel = accessLevel;
    }
    return delivery.result;
  }

  async function handleSubmit() {
    if (isSubmitting() || composer.isUploading()) return;
    const options = selectedOptions();
    const destination_ = destination();
    if (options.length === 0 || !destination_) {
      return setTriedToSubmit(true);
    }

    const targets: NonNullable<ReturnType<typeof destination>>[] =
      canSendAsGroup() && sendAsGroupMessage()
        ? [destination_]
        : options.map((option) =>
            option.kind === 'channel'
              ? { type: 'channel', id: option.id }
              : { type: 'users', users: [option.id] }
          );
    const accessLevel = submitAccessLevel();
    setIsSubmitting(true);
    try {
      const results = await Telemetry.span('share.forward', async (span) => {
        span.setAttr('entity.id', asAttachment().entity_id);
        span.setAttr('recipient.count', targets.length);
        span.setAttr(
          'attachment.count',
          (composer.message().attachments?.length ?? 0) + 1
        );
        const deliveries = await Promise.all(
          targets.map((target, index) =>
            span.span('share.deliver', async (deliverySpan) => {
              deliverySpan.setAttr('target.index', index);
              deliverySpan.setAttr('target.type', target.type);
              if (target.type === 'channel') {
                deliverySpan.setAttr('channel.id', target.id);
              } else {
                // User IDs can contain email addresses; only record the count.
                deliverySpan.setAttr('recipient.count', target.users.length);
              }
              const delivery = await sendForward(
                target,
                accessLevel,
                deliverySpan
              );
              deliverySpan.setAttr(
                'delivery.outcome',
                delivery ? 'success' : 'failure'
              );
              if (!delivery) {
                deliverySpan.error('Share delivery failed');
              }
              return delivery;
            })
          )
        );
        if (deliveries.some((delivery) => !delivery))
          span.error('Share failed');
        return deliveries;
      });
      props.refetch?.();
      if (results.some((result) => !result)) {
        if (targets.length > 1) {
          toast.failure('Some messages failed to send');
        }
        return;
      }

      if (targets.length > 1) {
        toast.success('Messages sent successfully');
      } else {
        const result = results[0];
        if (result) {
          toast.success('Message sent successfully', {
            actions: [
              {
                label: 'View in channel',
                onClick: result.navigateToChannel,
              },
            ],
          });
        }
      }
      deliveries.clear();
      composer.clear();
      props.onSubmit?.();
    } finally {
      setIsSubmitting(false);
    }
  }

  // Not detached: the handler below captures cmd+enter before the scope walk
  // reaches any ancestor, so the share menu can keep inheriting global hotkeys.
  const [attachHotkeys, shareHotkeyScope] = useHotkeyDOMScope(
    'share-forward-to-channel'
  );

  registerHotkey({
    hotkey: 'cmd+enter',
    scopeId: shareHotkeyScope,
    description: 'Share',
    // Fires from the composer, the recipient input and the access selector.
    runWithInputFocused: true,
    keyDownHandler: (event) => {
      // Holding the shortcut repeats keydown; swallow the repeats so one press
      // sends one share, but keep capturing them so none reaches the composer.
      if (event?.repeat) return true;
      fireAndForget(handleSubmit(), 'forward-to-channel');
      return true;
    },
  });

  onMount(() => {
    const container = containerRef();
    if (container) attachHotkeys(container);

    if (props.ref) {
      props.ref({
        getSubmitAccessLevel: submitAccessLevel,
        getSelectedOptions: selectedOptions,
        setSubmitAccessLevel,
        handleSubmit,
        canSubmit,
      });
    }
  });

  return (
    // Hosts the hotkey scope. `contents` keeps it out of the layout while it
    // still sees the focusin events that activate the scope.
    <div class="contents" ref={setContainerRef}>
      <Show
        when={!isMobile()}
        fallback={
          <MobileForwardToChannelLayout
            editPermissionEnabled={props.editPermissionEnabled}
            isAuthenticated={isAuthenticated}
            selectedOptions={selectedOptions}
            setSelectedOptions={(v) => setSelectedOptions(v)}
            triedToSubmit={triedToSubmit}
            destinationOptions={destinationOptions}
            submitPermissionInfo={props.submitPermissionInfo}
            hideAccessLevelSelector={props.hideAccessLevelSelector}
            allowedAccessLevels={props.allowedAccessLevels}
            submitAccessLevel={submitAccessLevel}
            setSubmitAccessLevel={setSubmitAccessLevel}
            composer={composer}
            handleSubmit={handleSubmit}
            canSendAsGroup={canSendAsGroup}
            sendAsGroupMessage={sendAsGroupMessage}
            setSendAsGroupMessage={setSendAsGroupMessage}
          />
        }
      >
        <Show when={isAuthenticated()}>
          {/* Row 1: Recipient input + ShareOptions */}
          <div class="flex items-center bg-surface pr-2">
            <div class="min-w-0 flex-1 min-h-11">
              <RecipientSelector<'user' | 'contact' | 'channel'>
                placeholder="To: Email or group"
                setSelectedOptions={setSelectedOptions}
                selectedOptions={selectedOptions()}
                triedToSubmit={triedToSubmit}
                options={destinationOptions}
                triggerMode="input"
                focusOnMount
                horizontalScroll
                hideBorder
              />
            </div>
            <Show
              when={
                props.submitPermissionInfo?.userPermissions ===
                  Permissions.OWNER && !props.hideAccessLevelSelector
              }
            >
              <div class="shrink-0 pr-2 flex items-center gap-2">
                <ShareOptions
                  editPermissionEnabled={props.editPermissionEnabled}
                  allowedAccessLevels={props.allowedAccessLevels}
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
            <ForwardMessageComposer composer={composer} />

            {/* Row 3: Send As Group (optional) + Cancel + Send */}
            <div class="shrink-0 flex w-full items-center px-4 py-4 gap-3 flex-wrap">
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
                          ? 'border-edge peer-checked:bg-surface/20'
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
                  class="text-ink-extra-muted"
                  onClick={() => props.onCancel?.()}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={!canSubmit()}
                  onClick={() => {
                    const options = selectedOptions();
                    if (options && options.length > 0) {
                      fireAndForget(handleSubmit(), 'forward-to-channel');
                    }
                  }}
                >
                  <PaperPlaneTilt class="size-4" />
                  Share
                  <Hotkey shortcut="cmd+enter" theme="current" />
                </Button>
              </div>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
}
