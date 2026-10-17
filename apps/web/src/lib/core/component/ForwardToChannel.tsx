import {
  parseChannelAccessLevel,
  type RecipientOption,
  type ShareForm,
  type ShareItem,
  type ShareSubmitResult,
  useShareForm,
} from '@app/features/sharing/share-delivery/share-delivery';
import { createConfiguredChannelMarkdownEditor } from '@channel/Input';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { useIsAuthenticated } from '@core/auth';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { ShareOptions } from '@core/component/TopBar/ShareButton';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isMobile } from '@core/mobile/isMobile';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import PaperPlaneTilt from '@phosphor/paper-plane-tilt.svg';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { Button, Hotkey } from '@ui';
import { type Accessor, createSignal, onMount, Show } from 'solid-js';
import { SendAsGroupToggle } from './SendAsGroupToggle';
import { toast } from './Toast/Toast';
import { ScrollIndicators } from './VerticalScrollIndicators';

interface MobileForwardToChannelLayoutProps
  extends Pick<ForwardToChannelProps, 'editPermissionEnabled'> {
  form: ShareForm<RecipientOption>;
  isAuthenticated: Accessor<boolean | undefined>;
  destinationOptions: ReturnType<typeof useCombinedRecipients>['all'];
  mdScrollRef: Accessor<HTMLElement | undefined>;
  setMdScrollRef: (el: HTMLElement) => void;
  markdownEditor: ReturnType<typeof createConfiguredChannelMarkdownEditor>;
}

function MobileForwardToChannelLayout(
  props: MobileForwardToChannelLayoutProps
) {
  return (
    <Show when={props.isAuthenticated()}>
      <div class="px-3 py-2 min-h-11" data-share-drawer-recipient>
        <RecipientSelector<'user' | 'contact' | 'channel'>
          placeholder="To: Email or group"
          setSelectedOptions={props.form.setRecipients}
          selectedOptions={props.form.recipients()}
          triedToSubmit={props.form.triedToSubmit}
          options={props.destinationOptions}
          triggerMode="input"
          class="border border-edge-muted p-1"
          focusOnMount
          disabled={props.form.locked()}
        />
      </div>
      {/* Send as group */}
      <Show when={props.form.group()}>
        {(group) => (
          <div class="shrink-0 flex w-full items-center p-3 gap-3 flex-wrap">
            <SendAsGroupToggle
              on={group().on}
              locked={props.form.locked()}
              onChange={props.form.setGroup}
            />
          </div>
        )}
      </Show>
      <Show when={props.form.level()}>
        {(level) => (
          <div class="px-3 py-2 flex items-center">
            <span class="text-sm text-ink-muted pr-2">Access:</span>
            <ShareOptions
              editPermissionEnabled={props.editPermissionEnabled}
              allowedAccessLevels={level().options}
              setPermissions={(accessLevel) =>
                pickLevel(props.form, accessLevel)
              }
              permissions={level().value}
              label="Permission"
              hideNoAccess
              disabled={props.form.locked()}
            />
          </div>
        )}
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
            disabled={props.form.locked()}
          />
        </div>
      </div>
    </Show>
  );
}

interface ForwardToChannelProps {
  item: ShareItem;
  editPermissionEnabled?: boolean;
  onSubmit?: () => void;
  onCancel?: () => void;
  refetch?: () => void;
  ref?: (ref: {
    getSelectedOptions: () => RecipientOption[];
    setSubmitAccessLevel: (level: AccessLevel | null) => void;
    getSubmitAccessLevel: () => AccessLevel | null;
    handleSubmit: () => void;
  }) => void;
}

export function ForwardToChannel(props: ForwardToChannelProps) {
  const isAuthenticated = useIsAuthenticated();
  const form = useShareForm(() => [props.item], {
    location: 'forward_to_channel',
  });

  const [mdScrollRef, setMdScrollRef] = createSignal<HTMLElement>();
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();

  // No onEnter: the optional message is a multi-line composer, so a bare Enter
  // falls through to Lexical and inserts a newline. Sharing is bound to
  // cmd+enter through the hotkey system below.
  const markdownEditor = createConfiguredChannelMarkdownEditor({
    namespace: 'forward-to-channel-markdown',
    resolveAppLink: useMacroMentionLinkResolver(),
    enableMentions: true,
    onChange: form.setText,
  });
  const { all: destinationOptions } = useCombinedRecipients();

  async function handleSubmit() {
    const result = await form.submit();
    if (!result) return;
    props.refetch?.();
    toastForwardResult(result);
    if (result.outcome.complete) props.onSubmit?.();
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
      void handleSubmit();
      return true;
    },
  });

  onMount(() => {
    const container = containerRef();
    if (container) attachHotkeys(container);

    if (props.ref) {
      props.ref({
        getSubmitAccessLevel: () => form.level()?.value ?? null,
        getSelectedOptions: form.recipients,
        setSubmitAccessLevel: (level) => pickLevel(form, level),
        handleSubmit,
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
            form={form}
            isAuthenticated={isAuthenticated}
            destinationOptions={destinationOptions}
            mdScrollRef={mdScrollRef}
            setMdScrollRef={setMdScrollRef}
            markdownEditor={markdownEditor}
          />
        }
      >
        <Show when={isAuthenticated()}>
          {/* Row 1: Recipient input + ShareOptions */}
          <div class="flex items-center bg-surface pr-2">
            <div class="min-w-0 flex-1 min-h-11">
              <RecipientSelector<'user' | 'contact' | 'channel'>
                placeholder="To: Email or group"
                setSelectedOptions={form.setRecipients}
                selectedOptions={form.recipients()}
                triedToSubmit={form.triedToSubmit}
                options={destinationOptions}
                triggerMode="input"
                focusOnMount
                horizontalScroll
                hideBorder
                disabled={form.locked()}
              />
            </div>
            <Show when={form.level()}>
              {(level) => (
                <div class="shrink-0 pr-2 flex items-center gap-2">
                  <Show when={form.recipients().length > 0}>
                    <span class="text-sm text-ink-extra-muted">can</span>
                  </Show>
                  <ShareOptions
                    editPermissionEnabled={props.editPermissionEnabled}
                    allowedAccessLevels={level().options}
                    setPermissions={(accessLevel) =>
                      pickLevel(form, accessLevel)
                    }
                    permissions={level().value}
                    label="Permission"
                    hideNoAccess
                    noBorder
                    disabled={form.locked()}
                  />
                </div>
              )}
            </Show>
          </div>

          {/* Row 2: Optional message */}
          <div class="grow shrink min-h-0 flex flex-col w-full border-t border-edge-muted">
            <div class="relative grow shrink min-h-0 flex flex-col">
              <ScrollIndicators scrollRef={mdScrollRef} noBorderStart />
              <CustomScrollbar scrollContainer={mdScrollRef} />
              <div
                class="grow shrink min-h-20 max-h-40 overflow-y-auto scrollbar-hidden px-4 py-1.5 w-full text-sm"
                onClick={() => markdownEditor.controls.focus()}
                ref={setMdScrollRef}
              >
                <MarkdownShell
                  config={markdownEditor}
                  placeholder="Optional message"
                  portalScope="local"
                  class="text-sm"
                  disabled={form.locked()}
                />
              </div>
            </div>

            {/* Row 3: Send As Group (optional) + Cancel + Send */}
            <div class="shrink-0 flex w-full items-center px-4 py-4 gap-3 flex-wrap">
              <Show when={form.group()}>
                {(group) => (
                  <SendAsGroupToggle
                    on={group().on}
                    locked={form.locked()}
                    onChange={form.setGroup}
                  />
                )}
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
                  variant="strong"
                  depth={3}
                  disabled={
                    form.recipients().length === 0 ||
                    form.status().t === 'sending'
                  }
                  onClick={() => void handleSubmit()}
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

function pickLevel(
  form: ShareForm<RecipientOption>,
  level: AccessLevel | null
) {
  if (level === null) return;
  const parsed = parseChannelAccessLevel(level);
  if (parsed) form.setLevel(parsed);
}

function toastForwardResult({ outcome, open }: ShareSubmitResult) {
  for (const recipient of outcome.recipients) {
    if (recipient.unsent.length > 0) toast.failure('Message failed to send');
    if (recipient.accessIssues.length > 0) {
      toast.alert('Failed to change channel access', {
        subtext: 'Please try again',
      });
    }
  }
  if (!outcome.complete) {
    if (outcome.recipients.length > 1) {
      toast.failure('Some messages failed to send');
    }
    return;
  }
  if (outcome.recipients.length > 1) {
    toast.success('Messages sent successfully');
    return;
  }
  toast.success(
    'Message sent successfully',
    open && { actions: [{ label: 'View in channel', onClick: open }] }
  );
}
