/**
 * App adapters for the respond page's pickers: people and documents through
 * the mention menu the grid's entity cells use, related rows through the
 * grid's relation source. Values stay `CellValue`s of the column's kind.
 */
import {
  DatabaseMentionPicker,
  DatabaseMentionValue,
} from '@block-database/database-mentions';
import { createDatabaseRelations } from '@block-database/queries/database-relations';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import Plus from '@phosphor/plus.svg';
import X from '@phosphor/x.svg';
import { useDatabaseTableChanges } from '@queries/storage/databases-sync';
import { Checkbox, cn } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  EntityPickerProps,
  RelationPickerProps,
} from './context/form-context';
import type { FormEntityKind, FormEntityReference } from './core/form-model';

function entitiesOf(props: { value: EntityPickerProps['value'] }) {
  return props.value?.type === 'entities' ? props.value.value : [];
}

/** What a picker of `target` picks, in words. */
function entityNoun(target: FormEntityKind): string {
  return match(target)
    .with('USER', () => 'person')
    .with('DOCUMENT', () => 'document')
    .with('TASK', () => 'task')
    .with('COMPANY', () => 'company')
    .with('CONTACT', () => 'contact')
    .with('CALL_RECORD', () => 'call')
    .with('CHANNEL', () => 'channel')
    .with('CHAT', () => 'chat')
    .with('PROJECT', () => 'project')
    .with('THREAD', () => 'email')
    .with('CALENDAR_EVENT', () => 'event')
    .with('INITIATIVE', () => 'initiative')
    .exhaustive();
}

export function FormEntityPicker(props: EntityPickerProps) {
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  let anchor: HTMLButtonElement | undefined;
  const chosen = () => entitiesOf(props);
  const set = (next: FormEntityReference[]) =>
    props.onChange(
      next.length ? { type: 'entities', value: next } : { type: 'clear' }
    );
  const noun = () => entityNoun(props.target);
  return (
    <div class="flex flex-col gap-2">
      <Show when={chosen().length > 0}>
        <ul
          class="flex flex-wrap gap-1.5"
          aria-label={`${props.label}: chosen`}
        >
          <For each={chosen()}>
            {(entity) => (
              <li class="flex items-center gap-1 rounded-full border border-edge-muted bg-panel py-0.5 pr-1 pl-2 text-sm">
                <DatabaseMentionValue
                  id={entity.entityId}
                  entityType={entity.entityType}
                />
                <button
                  type="button"
                  aria-label="Remove"
                  class="flex size-5 items-center justify-center rounded-full text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-edge-focus"
                  onClick={() =>
                    set(
                      chosen().filter(
                        (item) => item.entityId !== entity.entityId
                      )
                    )
                  }
                >
                  <X class="size-3" />
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.multi || chosen().length === 0}>
        <button
          ref={anchor}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open()}
          aria-invalid={props.invalid}
          class={cn(
            'flex h-10 w-full max-w-sm items-center gap-2 rounded-md border bg-input px-3 text-left text-sm text-ink-placeholder outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-edge-focus',
            props.invalid ? 'border-failure' : 'border-edge-muted'
          )}
          onClick={() => {
            setSearch('');
            setOpen(true);
          }}
        >
          <Show
            when={chosen().length > 0}
            fallback={<MagnifyingGlass class="size-4" aria-hidden="true" />}
          >
            <Plus class="size-4" aria-hidden="true" />
          </Show>
          {chosen().length > 0
            ? `Add another ${noun()}`
            : `Choose ${/^[aeiou]/.test(noun()) ? 'an' : 'a'} ${noun()}`}
        </button>
      </Show>
      <Show when={open()}>
        <DatabaseMentionPicker
          anchor={anchor}
          specificEntityType={props.target}
          value={null}
          search={search()}
          onSearchChange={setSearch}
          onSelect={(mention) => {
            const reference: FormEntityReference = {
              entityType: props.target,
              entityId: mention.id,
            };
            set(
              props.multi
                ? [
                    ...chosen().filter((item) => item.entityId !== mention.id),
                    reference,
                  ]
                : [reference]
            );
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      </Show>
    </div>
  );
}

/** Rows of the related table, by their title column, searched in place. */
export function FormRelationPicker(props: RelationPickerProps) {
  const [search, setSearch] = createSignal('');
  const relations = createDatabaseRelations({
    targets: () => [{ databaseId: props.databaseId, tableId: props.tableId }],
    onTableChanged: (listener) =>
      useDatabaseTableChanges((change) => listener(change.tableId)),
  });
  const source = () => relations(props.tableId);
  const chosen = () => (props.value?.type === 'rows' ? props.value.value : []);
  const shown = () => {
    const term = search().trim().toLowerCase();
    const rows = source().rows();
    return term
      ? rows.filter((row) => row.name.toLowerCase().includes(term))
      : rows;
  };
  const toggle = (rowId: string, checked: boolean) => {
    const next = checked
      ? [...chosen(), rowId]
      : chosen().filter((id) => id !== rowId);
    props.onChange(
      next.length ? { type: 'rows', value: next } : { type: 'clear' }
    );
  };
  return (
    <div
      class={cn(
        'flex flex-col gap-2 rounded-lg border p-2',
        props.invalid ? 'border-failure' : 'border-edge-muted'
      )}
    >
      <input
        type="search"
        aria-label={`Search ${source().name() || 'rows'}`}
        placeholder={`Search ${source().name() || 'rows'}`}
        value={search()}
        class="h-9 w-full rounded-md border border-edge-muted bg-input px-2.5 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-edge-focus"
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
      <Show
        when={!source().error()}
        fallback={
          <p class="px-1 text-xs text-ink-muted">
            You need access to {source().name() || 'the related table'} to pick
            its rows.
          </p>
        }
      >
        <Show
          when={!source().loading() || source().rows().length > 0}
          fallback={<p class="px-1 text-xs text-ink-muted">Loading rows…</p>}
        >
          <ul
            class="flex max-h-56 flex-col overflow-y-auto"
            aria-label={props.label}
          >
            <For
              each={shown()}
              fallback={
                <li class="px-1 py-1 text-xs text-ink-muted">No rows match.</li>
              }
            >
              {(row) => (
                <li>
                  <Checkbox
                    checked={chosen().includes(row.id)}
                    onChange={(checked) => toggle(row.id, checked)}
                    class="flex min-h-8 gap-2.5 rounded-md px-1.5 text-sm text-ink hover:bg-hover"
                  >
                    <Checkbox.Control class="border-ink-extra-muted" />
                    <Checkbox.Label class="flex min-h-8 min-w-0 flex-1 items-center">
                      <span class="truncate">{row.name || 'Untitled'}</span>
                    </Checkbox.Label>
                  </Checkbox>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  );
}
