import { usePreserveFocusOnButtonTaps } from '@core/mobile/usePreserveFocusOnButtonTaps';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { DeliveryStatus } from '../../whatsapp-linked/components/delivery-status';
import type { PendingSend } from '../core/group';

export function GroupComposer(props: {
  canSend: boolean;
  editing: boolean;
  note: string;
  draft: string;
  busy: boolean;
  fileName?: string;
  target?: { name: string; body: string };
  error?: string;
  pending: PendingSend[];
  onDraft: (value: string) => void;
  onFile: (file: File | undefined) => void;
  onCancelTarget: () => void;
  onSubmit: () => void;
  onConnect: () => void;
}) {
  let container: HTMLDivElement | undefined;
  usePreserveFocusOnButtonTaps(() => container);
  useTouchOutsideToDismissKeyboard(() => container);
  return (
    <div
      ref={container}
      class="shrink-0 border-t border-edge-muted bg-panel px-3 pt-3 pb-4 touch:pb-[max(1rem,var(--mobile-content-inset-bottom,var(--safe-bottom,0px)))] sm:px-6"
    >
      <For each={props.pending}>
        {(send) => (
          <div class="mb-2 rounded-md border border-edge-muted p-2 ph-no-capture">
            <p class="text-sm break-words">{send.preview}</p>
            <DeliveryStatus state={send.state} errorCode={send.errorCode} />
          </div>
        )}
      </For>
      <Show when={props.target}>
        {(target) => (
          <div class="mb-2 flex min-w-0 items-center gap-2 border-l-2 border-accent pl-3 text-xs">
            <div class="min-w-0 flex-1">
              <strong>{target().name}</strong>
              <p class="truncate">{target().body}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={props.onCancelTarget}>
              Cancel
            </Button>
          </div>
        )}
      </Show>
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <span>{props.note}</span>
        <Show when={props.note === 'Connect your WhatsApp to reply'}>
          <Button variant="ghost" size="sm" onClick={props.onConnect}>
            Connect WhatsApp
          </Button>
        </Show>
      </div>
      <Show when={props.canSend}>
        <form
          class="flex flex-col gap-2 rounded-xl border border-edge-muted p-2"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit();
          }}
        >
          <textarea
            aria-label="Message WhatsApp group"
            placeholder="Message this group…"
            class="min-h-16 max-h-40 w-full resize-y bg-transparent px-2 py-1 text-base outline-none ph-no-capture"
            value={props.draft}
            disabled={props.busy}
            onInput={(event) => props.onDraft(event.currentTarget.value)}
          />
          <div class="flex items-center gap-2">
            <Show when={!props.editing}>
              <label class="rounded-md px-2 py-2 text-sm not-touch:hover:bg-hover">
                <span>Attach file</span>
                <input
                  aria-label="Attach file"
                  class="sr-only"
                  type="file"
                  disabled={props.busy}
                  onChange={(event) => {
                    props.onFile(event.currentTarget.files?.[0]);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </Show>
            <Show when={props.fileName}>
              <span class="min-w-0 flex-1 truncate text-xs">
                {props.fileName}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={props.busy}
                onClick={() => props.onFile(undefined)}
              >
                Remove file
              </Button>
            </Show>
            <Button
              type="submit"
              variant="strong"
              size="sm"
              class="ml-auto"
              disabled={props.busy || (!props.draft.trim() && !props.fileName)}
            >
              {props.busy ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>
      </Show>
      <Show when={props.error}>
        <p role="alert" class="mt-2 text-xs text-failure-ink">
          {props.error}
        </p>
      </Show>
    </div>
  );
}
