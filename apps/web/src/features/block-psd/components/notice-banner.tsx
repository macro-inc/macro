/**
 * A dismissible bar above the canvas: what could not be read in the file,
 * and documents the editor cannot edit as they are (CMYK, Lab, 32-bit…)
 * with the conversion that makes them editable. Presentational.
 */

import WarningCircle from '@phosphor/warning-circle.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { createSignal, For, Show } from 'solid-js';

export function NoticeBanner(props: {
  /** What could not be read. */
  warnings: string[];
  /** Why the document can't be edited as it is, if so. */
  readOnlyReason?: string;
  /** Converts it to editable RGB (absent for viewers). */
  onConvert?: () => void;
}) {
  const [dismissed, setDismissed] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const shown = () =>
    !dismissed() && (props.warnings.length > 0 || !!props.readOnlyReason);
  return (
    <Show when={shown()}>
      <div
        role="status"
        class="flex shrink-0 items-start gap-2 border-edge-muted border-b bg-inset px-3 py-1.5 text-ink text-xs"
        data-testid="psd-notice"
      >
        <WarningCircle class="mt-0.5 size-3.5 shrink-0 text-warning" />
        <div class="min-w-0 flex-1">
          <Show when={props.readOnlyReason}>
            {(reason) => <p data-testid="psd-notice-readonly">{reason()}</p>}
          </Show>
          <Show when={props.warnings.length > 0}>
            <button
              type="button"
              class="text-left text-ink-muted hover:text-ink"
              data-testid="psd-notice-warnings"
              onClick={() => setExpanded((e) => !e)}
            >
              {props.warnings.length === 1
                ? 'One part of this file could not be read'
                : `${props.warnings.length} parts of this file could not be read`}
              {expanded() ? ' (hide)' : ' (details)'}
            </button>
            <Show when={expanded()}>
              <ul class="mt-1 list-disc pl-4 text-ink-muted">
                <For each={props.warnings}>{(w) => <li>{w}</li>}</For>
              </ul>
            </Show>
          </Show>
        </div>
        <Show when={props.readOnlyReason && props.onConvert}>
          <Button
            variant="outline"
            size="sm"
            data-testid="psd-notice-convert"
            onClick={() => props.onConvert?.()}
          >
            Convert to RGB
          </Button>
        </Show>
        <button
          type="button"
          aria-label="Dismiss"
          class="rounded p-0.5 text-ink-muted hover:text-ink"
          data-testid="psd-notice-dismiss"
          onClick={() => setDismissed(true)}
        >
          <X class="size-3.5" />
        </button>
      </div>
    </Show>
  );
}
