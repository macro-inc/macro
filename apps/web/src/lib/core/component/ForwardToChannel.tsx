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
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { ShareOptions } from '@core/component/TopBar/ShareButton';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isMobile } from '@core/mobile/isMobile';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import { fireAndForget } from '@core/util/fireAndForget';
import PaperPlaneTilt from '@phosphor/paper-plane-tilt.svg';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { Button, Hotkey } from '@ui';
import { createSignal, onMount, Show } from 'solid-js';
import { SendAsGroupToggle } from './SendAsGroupToggle';
import {
  MobileShareComposeLayout,
  ShareComposeLayout,
} from './ShareComposeLayout';
import { ShareRecipientField } from './ShareRecipientField';
import { toast } from './Toast/Toast';

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
      fireAndForget(handleSubmit(), 'forward-to-channel');
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

  const groupToggle = () => (
    <Show when={form.group()}>
      {(group) => (
        <SendAsGroupToggle
          on={group().on}
          locked={form.locked()}
          onChange={form.setGroup}
        />
      )}
    </Show>
  );
  const messageField = () => (
    <MarkdownShell
      config={markdownEditor}
      placeholder="Optional message"
      portalScope="local"
      class="text-sm"
      disabled={form.locked()}
    />
  );

  return (
    // Hosts the hotkey scope. `contents` keeps it out of the layout while it
    // still sees the focusin events that activate the scope.
    <div class="contents" ref={setContainerRef}>
      <Show when={isAuthenticated()}>
        <Show
          when={!isMobile()}
          fallback={
            <MobileShareComposeLayout
              recipients={
                <ShareRecipientField form={form} options={destinationOptions} />
              }
              group={groupToggle()}
              access={
                <Show when={form.level()}>
                  {(level) => (
                    <ShareOptions
                      editPermissionEnabled={props.editPermissionEnabled}
                      allowedAccessLevels={level().options}
                      setPermissions={(accessLevel) =>
                        pickLevel(form, accessLevel)
                      }
                      permissions={level().value}
                      label="Permission"
                      hideNoAccess
                      disabled={form.locked()}
                    />
                  )}
                </Show>
              }
              message={messageField()}
              focusMessage={() => markdownEditor.controls.focus()}
            />
          }
        >
          <ShareComposeLayout
            recipients={
              <ShareRecipientField form={form} options={destinationOptions} />
            }
            access={
              <Show when={form.level()}>
                {(level) => (
                  <>
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
                  </>
                )}
              </Show>
            }
            message={messageField()}
            focusMessage={() => markdownEditor.controls.focus()}
            group={groupToggle()}
            actions={
              <>
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
                  onClick={() =>
                    fireAndForget(handleSubmit(), 'forward-to-channel')
                  }
                >
                  <PaperPlaneTilt class="size-4" />
                  Share
                  <Hotkey shortcut="cmd+enter" theme="current" />
                </Button>
              </>
            }
          />
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
