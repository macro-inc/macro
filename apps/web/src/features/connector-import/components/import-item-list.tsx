import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { Checkbox } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import type { ImportItem } from '../core/import-items';

function ItemText(props: { item: ImportItem }): JSX.Element {
  return (
    <>
      <span class="block truncate font-medium text-ink">
        {props.item.title}
      </span>
      <Show when={props.item.detail}>
        <span class="block truncate text-xs text-ink-muted">
          {props.item.detail}
        </span>
      </Show>
      <Show when={props.item.status === 'staged' && props.item.error}>
        <span class="block text-xs text-failure">
          Last attempt failed. Select it to try again.
        </span>
      </Show>
    </>
  );
}

/** Discovered items: staged ones are selectable, the rest show progress. */
export function ImportItemList(props: {
  items: readonly ImportItem[];
  selected: ReadonlySet<string>;
  disabled?: boolean;
  onSelect(id: string, selected: boolean): void;
  href(entity: NonNullable<ImportItem['entity']>): string;
}) {
  return (
    <ul class="divide-y divide-edge-muted" aria-label="Items to import">
      <For each={props.items}>
        {(item) => (
          <li class="flex items-start gap-3 py-2.5 text-sm">
            <Switch>
              <Match when={item.status === 'staged'}>
                <Checkbox
                  class="flex min-w-0 flex-1 items-start gap-3"
                  checked={props.selected.has(item.id)}
                  disabled={props.disabled}
                  onChange={(checked) => props.onSelect(item.id, checked)}
                >
                  <Checkbox.Control class="mt-0.5" />
                  <Checkbox.Label class="min-w-0 flex-1">
                    <span class="sr-only">Select </span>
                    <ItemText item={item} />
                  </Checkbox.Label>
                </Checkbox>
              </Match>
              <Match when={item.status === 'importing'}>
                <SpinnerIcon
                  class="mt-0.5 size-4 shrink-0 animate-spin text-ink-muted"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1">
                  <ItemText item={item} />
                </span>
                <span class="shrink-0 text-xs text-ink-muted" role="status">
                  Importing…
                </span>
              </Match>
              <Match when={item.status === 'imported'}>
                <span class="size-4 shrink-0" aria-hidden="true" />
                <span class="min-w-0 flex-1">
                  <ItemText item={item} />
                </span>
                <Show
                  when={item.entity}
                  fallback={
                    <span class="shrink-0 text-xs text-ink-muted">
                      Imported
                    </span>
                  }
                >
                  {(entity) => (
                    <a
                      href={props.href(entity())}
                      class="inline-flex shrink-0 items-center gap-1 text-xs text-accent"
                      aria-label={`Open imported ${item.title}`}
                    >
                      Imported
                      <ArrowUpRightIcon class="size-3" aria-hidden="true" />
                    </a>
                  )}
                </Show>
              </Match>
            </Switch>
          </li>
        )}
      </For>
    </ul>
  );
}
