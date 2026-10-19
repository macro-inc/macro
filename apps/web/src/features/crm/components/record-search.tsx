import type { CollectionNode } from '@kobalte/core';
import { Combobox } from '@kobalte/core/combobox';
import PlusIcon from '@phosphor/plus.svg';
import { Layer } from '@ui';
import { createSignal, Show } from 'solid-js';
import { PropertyIcon } from '../../database/components/property-icon';
import type { Pipeline } from '../core/pipeline';
import { type RecordOption, recordDetail } from '../core/pipeline-record';

/** A search result row: a record to pick, or the search itself as a record to create. */
type SearchItem =
  | { kind: 'record'; record: RecordOption }
  | { kind: 'create'; search: string };

const MAX_RESULTS = 50;

/** Find a company or contact by name or detail, or start a new one from the search. */
export function RecordSearch(props: {
  recordType: Pipeline['recordType'];
  options: RecordOption[];
  loading: boolean;
  /** Mount the menu here, e.g. a modal dialog's content, which hides body portals. */
  mount?: HTMLElement;
  onPick: (record: RecordOption) => void;
  onCreate: (search: string) => void;
}) {
  const [search, setSearch] = createSignal('');
  const noun = () => (props.recordType === 'company' ? 'company' : 'contact');
  const items = (): SearchItem[] => {
    const query = search().trim();
    const lower = query.toLowerCase();
    const matches = props.options
      .filter(
        (option) =>
          option.name.toLowerCase().includes(lower) ||
          option.detail.toLowerCase().includes(lower)
      )
      .slice(0, MAX_RESULTS)
      .map((record): SearchItem => ({ kind: 'record', record }));
    return query ? [...matches, { kind: 'create', search: query }] : matches;
  };
  return (
    <Combobox<SearchItem>
      multiple={false}
      options={items()}
      value={null}
      onChange={(item) => {
        if (!item) return;
        if (item.kind === 'record') props.onPick(item.record);
        else props.onCreate(item.search);
      }}
      onInputChange={setSearch}
      optionValue={(item) =>
        item.kind === 'record' ? item.record.id : 'create'
      }
      optionTextValue={(item) =>
        item.kind === 'record'
          ? `${item.record.name} ${item.record.detail}`
          : item.search
      }
      optionLabel={() => ''}
      defaultFilter={() => true}
      allowsEmptyCollection
      placement="bottom-start"
      gutter={8}
      sameWidth
      itemComponent={(itemProps: { item: CollectionNode<SearchItem> }) => (
        <Combobox.Item
          item={itemProps.item}
          class="flex w-full cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm data-highlighted:bg-ink/5"
        >
          <Show
            when={
              itemProps.item.rawValue.kind === 'record' &&
              itemProps.item.rawValue.record
            }
            fallback={
              <>
                <PlusIcon class="size-3.5 shrink-0 text-ink-muted" />
                <Combobox.ItemLabel class="min-w-0 truncate text-ink">
                  Add {noun()} “{search().trim()}”
                </Combobox.ItemLabel>
              </>
            }
          >
            {(record) => (
              <>
                <PropertyIcon
                  type="ENTITY"
                  entityType={
                    props.recordType === 'company' ? 'COMPANY' : 'CONTACT'
                  }
                />
                <Combobox.ItemLabel class="min-w-0 truncate text-ink">
                  {record().name}
                </Combobox.ItemLabel>
                <span class="ml-auto min-w-0 shrink-[2] truncate text-xs text-ink-extra-muted">
                  {recordDetail(record())}
                </span>
              </>
            )}
          </Show>
        </Combobox.Item>
      )}
    >
      <Combobox.Control class="flex min-w-0 flex-1 items-center gap-2">
        <PropertyIcon
          type="ENTITY"
          entityType={props.recordType === 'company' ? 'COMPANY' : 'CONTACT'}
          class="size-5 shrink-0 text-ink-muted"
        />
        <Combobox.Input
          aria-label={`Find or add a ${noun()}`}
          placeholder={`Find or add a ${noun()}…`}
          autocomplete="off"
          data-1p-ignore
          class="ph-no-capture w-full min-w-0 bg-transparent text-xl/7 font-medium text-ink outline-none placeholder:text-ink-placeholder"
        />
      </Combobox.Control>
      <Combobox.Portal mount={props.mount}>
        <Layer depth={2}>
          <Combobox.Content class="menu-surface z-action-menu overflow-hidden">
            {/* Pressing an option must not move focus to the dialog, which
                closes the menu before the click selects it. */}
            <div class="p-1" onMouseDown={(event) => event.preventDefault()}>
              <Show
                when={items().length}
                fallback={
                  <div class="px-2 py-3 text-center text-xs text-ink-muted">
                    {props.loading
                      ? `Loading ${noun() === 'company' ? 'companies' : 'contacts'}…`
                      : `Type a name to add a ${noun()}`}
                  </div>
                }
              >
                <Combobox.Listbox class="max-h-64 overflow-y-auto scrollbar-hidden" />
              </Show>
            </div>
          </Combobox.Content>
        </Layer>
      </Combobox.Portal>
    </Combobox>
  );
}
