import { Toolbar } from '@ui';
import {
  type Accessor,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import type {
  BodyPopupOpenedPrompt,
  BodyPopupSlot,
  BodyPopupSlotId,
} from './body-popup-slots';

/** The body popup toolbar (Source MarkdownPopupToolbar, MarkdownPopup.tsx:
 *  621-810): selection actions, then FormatTools, then the popup's trailing
 *  actions. A slot's prompt replaces the whole toolbar at its measured width.
 *  Its state lives here, inside the popup's Show, so it resets when the
 *  popup hides, as Source's toolbar-local state does. */
export function NativeBodyToolbar(props: {
  slots: readonly BodyPopupSlot[];
  /** Formatting actions apply; selection actions do not depend on it. */
  interactable: Accessor<boolean>;
  /** FormatTools, with its Link button opening the link slot's prompt. */
  formatTools(requestLink: () => void): JSX.Element;
  /** Comment and snippet-link actions, after FormatTools. */
  trailing?(): JSX.Element;
  /** Hide the popup. */
  hide(): void;
  /** Refocus the editor (Source dismissPrompt). */
  focusEditor(): void;
  /** The toolbar unmounted, i.e. the popup hid. */
  onClosed?: () => void;
}) {
  onCleanup(() => props.onClosed?.());
  const seen = new Set<BodyPopupSlotId>();
  for (const slot of props.slots) {
    if (seen.has(slot.id))
      throw new Error(`Duplicate body popup slot id: ${slot.id}`);
    seen.add(slot.id);
  }
  const [prompt, setPrompt] = createSignal<BodyPopupOpenedPrompt>();
  const [width, setWidth] = createSignal<number>();

  const open = (id: BodyPopupSlotId) => {
    const opened = props.slots.find((slot) => slot.id === id)?.open?.();
    if (opened) setPrompt(() => opened);
  };
  const exits = {
    close: () => {
      setPrompt(undefined);
      props.hide();
    },
    dismiss: () => {
      setPrompt(undefined);
      for (const slot of props.slots) slot.dismissed?.();
      props.focusEditor();
    },
  };
  // Source measureToolbar: a prompt keeps the toolbar's footprint.
  const measure = (element: HTMLDivElement) => {
    const update = () => setWidth(element.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  };
  const actions = () =>
    props.slots.filter((slot) => slot.button && slot.available());

  return (
    <Show
      when={prompt()}
      fallback={
        <Toolbar ref={measure}>
          <For each={actions()}>
            {(slot) =>
              slot.button?.({ open: () => open(slot.id), close: props.hide })
            }
          </For>
          <Show when={actions().length > 0}>
            <Toolbar.Divider />
          </Show>
          <Show when={props.interactable()}>
            {props.formatTools(() => open('link'))}
          </Show>
          {props.trailing?.()}
        </Toolbar>
      }
    >
      {(opened) => (
        <Toolbar
          class="gap-2"
          style={{ width: width() ? `${width()}px` : undefined }}
        >
          {opened()(exits)}
        </Toolbar>
      )}
    </Show>
  );
}
