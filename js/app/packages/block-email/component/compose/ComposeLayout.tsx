import { CircleSpinner } from '@core/component/CircleSpinner';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { createSignal, type JSX, onMount, Show, Suspense } from 'solid-js';
import { ComposeBody } from './ComposeBody';
import { useCompose } from './ComposeContext';
import { ComposeRecipients } from './ComposeRecipients';
import { ComposeSubject } from './ComposeSubject';

type ComposeLayoutRefs = {
  directRecipientsSelector: HTMLElement | undefined;
  ccRecipientsSelector: HTMLElement | undefined;
  bccRecipientsSelector: HTMLElement | undefined;
  containerRef: HTMLElement | undefined;
  subjectInput: HTMLElement | undefined;
  messageInput: HTMLElement | undefined;
};

/**
 * Pure UI layout for the email compose form.
 * Renders recipients, subject, body, and toolbar.
 * Does NOT render any split-panel chrome — the caller is responsible for that.
 */
export function ComposeLayout(props: {
  toolbar?: JSX.Element;
  header?: JSX.Element;
  class?: string;
  bodyDebugName?: string;
}) {
  const ctx = useCompose();

  const [refs, setRefs] = createSignal<ComposeLayoutRefs>({
    directRecipientsSelector: undefined,
    ccRecipientsSelector: undefined,
    bccRecipientsSelector: undefined,
    containerRef: undefined,
    subjectInput: undefined,
    messageInput: undefined,
  });

  let mobileScrollRef: HTMLDivElement | undefined;

  const registerRef = (name: keyof ComposeLayoutRefs) => {
    return (el: HTMLElement) => {
      setRefs((p) => ({ ...p, [name]: el }));
    };
  };

  const [attachComposeHotkeys, composeHotkeyScope] =
    useHotkeyDOMScope('compose-email');

  const [showCc, setShowCc] = createSignal(false);
  const [showBcc, setShowBcc] = createSignal(false);

  const isCcVisible = () => showCc() || ctx.recipients().cc.length > 0;
  const isBccVisible = () => showBcc() || ctx.recipients().bcc.length > 0;

  onMount(() => {
    const container = refs().containerRef;
    if (!container) return;
    attachComposeHotkeys(container);
  });

  // --- Hotkeys ---

  registerHotkey({
    hotkey: 'shift+cmd+o',
    scopeId: composeHotkeyScope,
    description: 'Edit "To" recipients',
    keyDownHandler: () => {
      if (ctx.disabled()) return false;
      refs()?.directRecipientsSelector?.focus();
      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.recipients,
    shouldReturnFocusOnClose: false,
  });

  registerHotkey({
    hotkey: 'shift+cmd+c',
    scopeId: composeHotkeyScope,
    description: 'Edit "Cc" recipients',
    keyDownHandler: () => {
      if (ctx.disabled()) return false;
      if (!showCc()) {
        setShowCc(true);
        queueMicrotask(() => refs()?.ccRecipientsSelector?.focus());
        return true;
      }
      refs()?.ccRecipientsSelector?.focus();
      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.ccRecipients,
    shouldReturnFocusOnClose: false,
  });

  registerHotkey({
    hotkey: 'shift+cmd+b',
    scopeId: composeHotkeyScope,
    description: 'Edit "Bcc" recipients',
    keyDownHandler: () => {
      if (ctx.disabled()) return false;
      if (!showBcc()) {
        setShowBcc(true);
        queueMicrotask(() => refs()?.bccRecipientsSelector?.focus());
        return true;
      }
      refs()?.bccRecipientsSelector?.focus();
      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.bccRecipients,
    shouldReturnFocusOnClose: false,
  });

  registerHotkey({
    hotkey: 'shift+cmd+s',
    scopeId: composeHotkeyScope,
    description: 'Edit subject',
    keyDownHandler: () => {
      if (ctx.disabled()) return false;
      refs()?.subjectInput?.focus();
      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.subject,
    shouldReturnFocusOnClose: false,
  });

  registerHotkey({
    hotkey: 'shift+cmd+m',
    scopeId: composeHotkeyScope,
    description: 'Edit message',
    keyDownHandler: () => {
      if (ctx.disabled()) return false;
      refs()?.messageInput?.focus();
      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.message,
    shouldReturnFocusOnClose: false,
  });

  registerHotkey({
    hotkey: 'cmd+enter',
    scopeId: composeHotkeyScope,
    description: 'Send email',
    keyDownHandler: () => {
      if (ctx.disabled()) return false;
      if (ctx.sendTime()) return false;
      ctx.onSend();
      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: 'email.send',
    displayPriority: 10,
  });
  return (
    <div ref={registerRef('containerRef')} class={props.class}>
      <div class="pb-1 w-full h-max shrink-0">
        <div class="mb-4 h-6 flex items-center justify-between">
          <Show
            when={props.header}
            fallback={
              <Suspense
                fallback={
                  <div class="flex gap-1 items-center">
                    <CircleSpinner class="w-4 h-4 animate-spin" />
                    <span class="text-ink-extra-muted/50 text-xs">
                      Processing...
                    </span>
                  </div>
                }
              >
                <Show when={ctx.fromAddress?.()}>
                  {(addr) => (
                    <div class="text-xs text-ink-extra-muted/50">
                      from {addr()}
                    </div>
                  )}
                </Show>
              </Suspense>
            }
          >
            {props.header}
          </Show>
          <div class="flex gap-2 ml-auto">
            <Show when={!isCcVisible()}>
              <button
                type="button"
                class="text-ink-muted hover:text-ink hover:bg-hover"
                onClick={() => setShowCc(true)}
                disabled={ctx.disabled()}
              >
                + Cc
              </button>
            </Show>
            <Show when={!isBccVisible()}>
              <button
                type="button"
                class="text-ink-muted hover:text-ink hover:bg-hover"
                onClick={() => setShowBcc(true)}
                disabled={ctx.disabled()}
              >
                + Bcc
              </button>
            </Show>
          </div>
        </div>

        <ComposeRecipients
          toRef={registerRef('directRecipientsSelector')}
          ccRef={registerRef('ccRecipientsSelector')}
          bccRef={registerRef('bccRecipientsSelector')}
          showCc={showCc}
          setShowCc={setShowCc}
          showBcc={showBcc}
          setShowBcc={setShowBcc}
        />

        <ComposeSubject inputRef={registerRef('subjectInput')} />
      </div>

      <div class="w-full flex flex-col min-h-0 mt-4 h-full">
        <ComposeBody
          debugName={props.bodyDebugName}
          inputRef={registerRef('messageInput')}
          mobileScrollRef={() => mobileScrollRef}
          onAddFiles={(files) => {
            ctx.onAddAttachments(
              files.map((file) => ({ type: 'local', file }))
            );
          }}
        />
        {props.toolbar ?? ctx.toolbar?.()}
      </div>
    </div>
  );
}
