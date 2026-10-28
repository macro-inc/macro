import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import X from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { onMount } from 'solid-js';
import type { InputLayoutParts } from '../context/capabilities';
import type { OfferedSelection } from '../primitives/selection-offer';
import { SelectionUniversalInput } from '../universal-input';

/**
 * The card the reader gets beside their selection: the text it came from, then
 * the ordinary Universal Input form for the shape found in it.
 */
export function SelectionDraft(props: {
  offer: OfferedSelection;
  /** Height the floating card has beside its text, once it has been placed. */
  room?: number;
  onClose: () => void;
}) {
  const [attachHotkeys, scopeId] = useHotkeyDOMScope('selection-draft');
  registerHotkey({
    scopeId,
    hotkey: 'escape',
    description: 'Close the selection card',
    runWithInputFocused: true,
    hide: true,
    keyDownHandler: () => {
      props.onClose();
      return true;
    },
  });
  let card: HTMLDivElement | undefined;
  let quote: HTMLDivElement | undefined;
  // The chip the reader clicked is gone, so without this the card's keys —
  // Escape above all — would go to whatever held focus before it opened.
  onMount(() => card?.focus({ preventScroll: true }));
  // The form scrolls inside whatever the quote leaves of the room beside the
  // text, rather than running off the bottom of the window.
  const fieldsHeight = () => {
    const available = props.room;
    if (available === undefined) return 'min(30rem, calc(100vh - 7rem))';
    return `${Math.max(180, available - (quote?.offsetHeight ?? 0))}px`;
  };
  const layout = (parts: InputLayoutParts) => (
    <div
      ref={(element) => {
        card = element;
        attachHotkeys(element);
      }}
      tabindex={-1}
      class="flex flex-col gap-2 outline-none"
      style={{
        // The composer's panel surface is the page's own behind a dialog
        // overlay; floating over content it needs the menu surface instead.
        '--color-panel': 'var(--color-menu)',
        '--universal-input-max-height': fieldsHeight(),
        '--universal-input-body-overflow': 'auto',
      }}
    >
      {/* The quoted text and the form read as one card: the page behind them
          must not show through a seam. */}
      <div class="flex min-h-0 flex-col rounded-2xl shadow-menu [&_.universal-input-fields]:rounded-t-none [&_.universal-input-fields]:border-edge [&_.universal-input-fields]:border-t-0 [&_.universal-input-fields]:shadow-none">
        {parts.editor}
        {parts.fields}
      </div>
      {parts.result}
    </div>
  );
  return (
    <SelectionUniversalInput
      text={props.offer.text}
      intent={props.offer.intent}
      layout={layout}
      editor={
        <div
          ref={quote}
          class="flex shrink-0 items-start gap-2 rounded-t-2xl border border-edge bg-panel px-5 py-3 sm:px-6"
        >
          <blockquote class="line-clamp-2 min-w-0 flex-1 border-ink-extra-muted border-l-2 pl-2 text-ink-muted text-xs">
            {props.offer.text}
          </blockquote>
          <Button
            variant="ghost"
            size="icon-sm"
            label="Dismiss"
            class="-mt-1 -mr-2 shrink-0"
            onClick={props.onClose}
          >
            <X />
          </Button>
        </div>
      }
      onComplete={props.onClose}
      onNavigate={props.onClose}
    />
  );
}
