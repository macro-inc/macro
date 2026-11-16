import { children, createSignal, type JSX, Show } from 'solid-js';
import { CustomScrollbar } from './CustomScrollbar';
import { ScrollIndicators } from './VerticalScrollIndicators';

/**
 * The Share menu's message form: recipients and their access on one row, the
 * optional message below, then the send controls.
 */
export function ShareComposeLayout(props: {
  recipients: JSX.Element;
  access?: JSX.Element;
  message: JSX.Element;
  focusMessage: () => void;
  /** Notices or a send report, between the message and the send controls. */
  status?: JSX.Element;
  group?: JSX.Element;
  actions: JSX.Element;
}) {
  const [messageScrollRef, setMessageScrollRef] = createSignal<HTMLElement>();
  const access = children(() => props.access);
  const status = children(() => props.status);
  return (
    <>
      <div class="flex items-center bg-surface pr-2">
        <div class="min-w-0 flex-1 min-h-11">{props.recipients}</div>
        <Show when={access()}>
          <div class="shrink-0 pr-2 flex items-center gap-2">{access()}</div>
        </Show>
      </div>
      <div class="grow shrink min-h-0 flex flex-col w-full border-t border-edge-muted">
        <div class="relative grow shrink min-h-0 flex flex-col">
          <ScrollIndicators scrollRef={messageScrollRef} noBorderStart />
          <CustomScrollbar scrollContainer={messageScrollRef} />
          <div
            class="grow shrink min-h-20 max-h-40 overflow-y-auto scrollbar-hidden px-4 py-1.5 w-full text-sm"
            onClick={() => props.focusMessage()}
            ref={setMessageScrollRef}
          >
            {props.message}
          </div>
        </div>
        <Show when={status()}>
          <div class="border-t border-edge-muted px-4 py-3">{status()}</div>
        </Show>
        <div class="shrink-0 flex w-full items-center px-4 py-4 gap-3 flex-wrap">
          {props.group}
          <div class="flex flex-auto items-center justify-end gap-2">
            {props.actions}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The Share drawer's message form: the To field, the group toggle, and the
 * access level stacked above the optional message. The send button lives in
 * the drawer's header.
 */
export function MobileShareComposeLayout(props: {
  recipients: JSX.Element;
  group?: JSX.Element;
  access?: JSX.Element;
  /** Notices or a send report, between the access level and the message. */
  status?: JSX.Element;
  message: JSX.Element;
  focusMessage: () => void;
}) {
  const [messageScrollRef, setMessageScrollRef] = createSignal<HTMLElement>();
  const group = children(() => props.group);
  const access = children(() => props.access);
  const status = children(() => props.status);
  return (
    <>
      <div class="px-3 py-2 min-h-11" data-share-drawer-recipient>
        {props.recipients}
      </div>
      <Show when={group()}>
        <div class="shrink-0 flex w-full items-center p-3 gap-3 flex-wrap">
          {group()}
        </div>
      </Show>
      <Show when={access()}>
        <div class="px-3 py-2 flex items-center">
          <span class="text-sm text-ink-muted pr-2">Access:</span>
          {access()}
        </div>
      </Show>
      <Show when={status()}>
        <div class="px-3 py-2">{status()}</div>
      </Show>
      <div class="flex-1 min-h-20 flex flex-col w-full mt-3 border-t border-edge-muted relative">
        <ScrollIndicators scrollRef={messageScrollRef} noBorderStart />
        <CustomScrollbar scrollContainer={messageScrollRef} />
        <div
          class="grow shrink min-h-20 overflow-y-auto scrollbar-hidden px-3 py-1.5 w-full text-sm"
          onClick={() => props.focusMessage()}
          ref={setMessageScrollRef}
        >
          {props.message}
        </div>
      </div>
    </>
  );
}
