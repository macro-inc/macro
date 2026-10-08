import type { CollectionNode } from '@kobalte/core';
import { Combobox } from '@kobalte/core/combobox';
import BuildingsIcon from '@phosphor/buildings.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { Layer } from '@ui';
import { type Accessor, createSignal, Show } from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';

export type CompanyOption = { id: string; name: string; domain: string };

const ITEM_HEIGHT = 32;

function CompanyListbox() {
  let handle: VirtualizerHandle | undefined;
  // Kobalte hands back the filtered collection, so scrolling indexes into it.
  let visible: Accessor<Iterable<CollectionNode<CompanyOption>>> | undefined;
  return (
    <Combobox.Listbox<CompanyOption>
      scrollToItem={(key) => {
        const index = Array.from(visible?.() ?? []).findIndex(
          (item) => item.rawValue.id === key
        );
        if (index !== -1) handle?.scrollToIndex(index, { align: 'nearest' });
      }}
      class="max-h-60 overflow-y-auto scrollbar-hidden"
    >
      {(items) => {
        visible = items;
        return (
          <Virtualizer
            ref={(h) => (handle = h)}
            data={[...items()]}
            itemSize={ITEM_HEIGHT}
          >
            {(item) => (
              <Combobox.Item
                item={item}
                class="flex w-full cursor-default items-center gap-1.5 rounded-lg p-1.5 px-2 text-left text-sm data-highlighted:bg-ink/5"
              >
                <span class="flex size-3.5 shrink-0 items-center justify-center text-accent">
                  <Combobox.ItemIndicator>
                    <CheckIcon class="size-3" />
                  </Combobox.ItemIndicator>
                </span>
                <Combobox.ItemLabel class="min-w-0 truncate text-ink">
                  {item.rawValue.name}
                </Combobox.ItemLabel>
                <span class="ml-auto min-w-0 shrink-[2] truncate text-xs text-ink-extra-muted">
                  {item.rawValue.domain}
                </span>
              </Combobox.Item>
            )}
          </Virtualizer>
        );
      }}
    </Combobox.Listbox>
  );
}

/** Searchable single-company picker, matching on name or domain. */
export function CompanySelect(props: {
  id?: string;
  companies: CompanyOption[];
  value: CompanyOption | undefined;
  onChange: (company: CompanyOption) => void;
  loading: boolean;
  /** Mount the menu in the nearest portal scope, e.g. inside a modal dialog. */
  portalScope?: 'local';
}) {
  let trigger: HTMLButtonElement | undefined;
  const [search, setSearch] = createSignal('');
  const matches = (option: CompanyOption, query: string) =>
    option.name.toLowerCase().includes(query) ||
    option.domain.toLowerCase().includes(query);
  const hasMatches = () => {
    const query = search().trim().toLowerCase();
    return props.companies.some((option) => matches(option, query));
  };
  return (
    <Combobox<CompanyOption>
      multiple={false}
      options={props.companies}
      value={props.value ?? null}
      onChange={(option) => option && props.onChange(option)}
      onInputChange={setSearch}
      onOpenChange={(open) => !open && setSearch('')}
      optionValue="id"
      optionTextValue={(option) => `${option.name} ${option.domain}`}
      // The trigger shows the selection; keep the search box empty on open.
      optionLabel={() => ''}
      defaultFilter={(option, input) =>
        matches(option, input.trim().toLowerCase())
      }
      virtualized
      allowsEmptyCollection
      placement="bottom-start"
      sameWidth
      gutter={4}
    >
      <Combobox.Control>
        <Combobox.Trigger
          ref={trigger}
          id={props.id}
          type="button"
          class="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-edge-muted px-3 text-left text-sm text-ink outline-none focus-visible:border-edge"
        >
          <BuildingsIcon class="size-4 shrink-0 text-ink-placeholder" />
          <Show
            when={props.value}
            fallback={
              <span class="flex-1 truncate text-ink-placeholder">
                {props.loading ? 'Loading companies…' : 'Choose a company'}
              </span>
            }
          >
            {(company) => (
              <span class="flex min-w-0 flex-1 items-baseline gap-2">
                <span class="truncate">{company().name}</span>
                <span class="truncate text-xs text-ink-extra-muted">
                  {company().domain}
                </span>
              </span>
            )}
          </Show>
          <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
        </Combobox.Trigger>
      </Combobox.Control>
      <Combobox.Portal
        mount={
          props.portalScope === 'local'
            ? (trigger?.closest<HTMLElement>('.portal-scope') ?? undefined)
            : undefined
        }
      >
        <Layer depth={2}>
          <Combobox.Content class="z-action-menu overflow-hidden rounded-xl border border-edge-muted bg-surface shadow-md">
            <div class="flex items-center gap-2 border-b border-edge-muted px-3 py-2">
              <SearchIcon class="size-3.5 shrink-0 text-ink-muted" />
              <Combobox.Input
                class="min-w-0 flex-1 bg-transparent text-sm caret-accent outline-none placeholder:text-ink-placeholder"
                placeholder="Search companies..."
              />
            </div>
            {/* Pressing an option must not move focus to the dialog, which
                closes the menu before the click selects it. */}
            <div class="p-1" onMouseDown={(event) => event.preventDefault()}>
              <Show
                when={hasMatches()}
                fallback={
                  <div class="px-2 py-3 text-center text-xs text-ink-muted">
                    {props.loading
                      ? 'Loading companies…'
                      : search().trim()
                        ? `No companies match "${search().trim()}"`
                        : 'No companies yet'}
                  </div>
                }
              >
                <CompanyListbox />
              </Show>
            </div>
          </Combobox.Content>
        </Layer>
      </Combobox.Portal>
    </Combobox>
  );
}
