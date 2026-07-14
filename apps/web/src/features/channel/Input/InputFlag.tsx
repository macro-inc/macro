import XIcon from '@phosphor/x.svg';
import { Layer } from '@ui';
import { type JSX, Show } from 'solid-js';

const labelClass =
  'min-w-0 truncate text-left text-xs text-ink-muted pl-3 py-1.5';

/**
 * A contextual flag pinned to the top edge of the channel input, for surfacing
 * something about the input's current mode or state — the message being
 * replied to or edited, etc.
 *
 * `label` is the flag's content. Pass `onActivate` to make it tappable (its
 * primary action, e.g. jump to the referenced message); omit it for a purely
 * informational flag. Pass `onDismiss` to show a dismiss (×) button.
 */
export function InputFlag(props: {
  label: JSX.Element;
  onActivate?: () => void;
  /** Accessible name for the dismiss button; required when `onDismiss` is set. */
  dismissLabel?: string;
  onDismiss?: () => void;
}) {
  return (
    <Layer depth={2}>
      {/* Opt into the input's keyboard-safe zone so tapping the flag (a sibling
          of ChannelInput, outside its container) doesn't dismiss the keyboard. */}
      <div
        data-keep-keyboard
        class="w-full macro-message-width flex justify-center"
      >
        <div class="w-[calc(100%-2px)] max-w-full flex items-center justify-between bg-surface rounded-t-2xl border-t border-l border-r border-edge -mb-6.5 pb-6">
          <Show
            when={props.onActivate}
            fallback={<div class={labelClass}>{props.label}</div>}
          >
            <button
              type="button"
              class={labelClass}
              onClick={() => props.onActivate?.()}
            >
              {props.label}
            </button>
          </Show>
          <Show when={props.onDismiss}>
            <button
              type="button"
              aria-label={props.dismissLabel}
              class="shrink-0 px-2 py-1.5 text-ink-muted"
              onClick={() => props.onDismiss?.()}
            >
              <XIcon class="size-5" aria-hidden="true" />
            </button>
          </Show>
        </div>
      </div>
    </Layer>
  );
}
