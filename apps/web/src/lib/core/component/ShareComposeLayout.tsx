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
