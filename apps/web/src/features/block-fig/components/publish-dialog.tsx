/**
 * "Publish library": the changes since the last publish (new, changed, and
 * removed components, styles, and variables, with their descriptions) and
 * a note for the files that use the library. Presentational.
 */

import type {
  AssetChange,
  LibraryStatus,
} from '@core/fig-engine/library-types';
import XIcon from '@phosphor/x.svg';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { match } from 'ts-pattern';

const KIND_LABEL: Record<AssetChange['kind'], string> = {
  COMPONENT: 'Component',
  COMPONENT_SET: 'Component set',
  STYLE: 'Style',
  VARIABLE: 'Variable',
  COLLECTION: 'Collection',
};

function ChangeBadge(props: { change: AssetChange['change'] }) {
  return (
    <span
      class="rounded px-1 text-[10px] uppercase"
      classList={{
        'bg-accent-bg text-accent': props.change === 'NEW',
        'bg-inset text-ink-muted': props.change === 'CHANGED',
        'bg-inset text-failure': props.change === 'REMOVED',
      }}
    >
      {match(props.change)
        .with('NEW', () => 'New')
        .with('CHANGED', () => 'Changed')
        .with('REMOVED', () => 'Removed')
        .exhaustive()}
    </span>
  );
}

export function PublishDialog(props: {
  status: LibraryStatus;
  publishing: boolean;
  onPublish: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = createSignal('');
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      class="fig-editor-theme w-120"
    >
      <Panel depth={2} class="rounded-xl *:max-h-[80vh]">
        <Panel.Body scroll>
          <div
            class="flex flex-col gap-4 p-5 text-sm"
            data-testid="fig-publish-dialog"
          >
            <div class="flex items-center justify-between gap-4">
              <Dialog.Title class="font-semibold text-base text-ink">
                Publish library
              </Dialog.Title>
              <Dialog.CloseButton
                as={Button}
                variant="ghost"
                size="icon-sm"
                label="Close"
                tabIndex={-1}
              >
                <XIcon />
              </Dialog.CloseButton>
            </div>
            <textarea
              class="min-h-16 rounded-md border border-edge-muted bg-input p-2 text-ink text-xs outline-none placeholder:text-ink-placeholder"
              placeholder="Describe what changed (optional)"
              data-testid="fig-publish-note"
              value={note()}
              onInput={(e) => setNote(e.currentTarget.value)}
            />
            <section class="flex flex-col gap-1">
              <h3 class="font-medium text-ink-muted text-xs">
                {props.status.changes.length === 1
                  ? '1 change'
                  : `${props.status.changes.length} changes`}
              </h3>
              <ul class="flex flex-col">
                <For
                  each={props.status.changes}
                  fallback={
                    <li class="py-1 text-ink-muted text-xs">
                      Nothing changed since the last publish.
                    </li>
                  }
                >
                  {(c) => (
                    <li
                      class="flex flex-col py-1"
                      data-testid="fig-publish-change"
                    >
                      <div class="flex items-center gap-2">
                        <ChangeBadge change={c.change} />
                        <span class="min-w-0 flex-1 truncate text-ink">
                          {c.name}
                        </span>
                        <span class="text-ink-muted text-xs">
                          {KIND_LABEL[c.kind]}
                        </span>
                      </div>
                      <Show when={c.description}>
                        {(d) => (
                          <p class="pl-1 text-ink-muted text-xs">{d()}</p>
                        )}
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </section>
            <div class="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => props.onClose()}>
                Cancel
              </Button>
              <Button
                variant="cta"
                size="sm"
                data-testid="fig-publish-confirm"
                disabled={props.publishing || props.status.changes.length === 0}
                onClick={() => props.onPublish(note())}
              >
                {props.publishing ? 'Publishing…' : 'Publish'}
              </Button>
            </div>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
