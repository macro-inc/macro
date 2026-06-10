import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { Combobox } from '@kobalte/core/combobox';
import XIcon from '@phosphor/x.svg';
import { Button, Dropdown, Layer, SingleSelectCheck } from '@ui';
import {
  type Accessor,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { SearchableMultiSelect } from '../searchable-multi-select';
import type { FacetOption, SearchFacetVM } from './search-facets';

interface SearchFacetChipProps {
  facet: SearchFacetVM;
  open?: Accessor<boolean>;
  setOpen?: (v: boolean) => void;
}

const ChipDivider = () => (
  <div class="w-px self-stretch bg-edge-muted shrink-0" />
);

const ValueDisplay = (props: { values: FacetOption[] }) => {
  const first = () => props.values[0];
  const overflowCount = () => props.values.length - 1;

  return (
    <span
      class="inline-flex h-full items-center gap-1.5"
      title={props.values.map((v) => v.label).join(', ')}
    >
      <Show when={first()?.icon}>
        {(icon) => (
          <span class="size-4 flex items-center justify-center shrink-0">
            {icon()()}
          </span>
        )}
      </Show>
      <span class="truncate max-w-32">{first()?.label}</span>
      <Show when={overflowCount() > 0}>
        <span class="inline-flex items-center justify-center px-1 min-w-4 h-4 rounded-full bg-ink/10 text-xxs">
          +{overflowCount()}
        </span>
      </Show>
    </span>
  );
};

const SingleValueSegment = (props: {
  facet: Extract<SearchFacetVM, { kind: 'single' }>;
  open?: Accessor<boolean>;
  setOpen?: (v: boolean) => void;
}) => {
  const [internalOpen, setInternalOpen] = createSignal(false);
  const isOpen = () => (props.open ? props.open() : internalOpen());
  const setOpen = (v: boolean) => (props.setOpen ?? setInternalOpen)(v);

  return (
    <Dropdown open={isOpen()} onOpenChange={setOpen}>
      <Dropdown.Trigger
        variant="ghost"
        class="inline-flex items-center gap-1.5 px-2 h-auto! hover:bg-ink/5 active:bg-ink/8 rounded-none"
      >
        <ValueDisplay values={props.facet.values()} />
      </Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Group>
          <For each={props.facet.options}>
            {(option) => (
              <Dropdown.Item
                onSelect={() => props.facet.onSelect(option.id)}
                closeOnSelect
              >
                <Show when={option.icon}>
                  {(icon) => (
                    <span class="size-4 flex items-center justify-center shrink-0">
                      {icon()()}
                    </span>
                  )}
                </Show>
                <span class="flex-1 truncate">{option.label}</span>
                <SingleSelectCheck
                  active={props.facet.selectedId() === option.id}
                />
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
};

const MultiValueSegment = (props: {
  facet: Extract<SearchFacetVM, { kind: 'multi' }>;
}) => {
  const panel = useSplitPanelOrThrow();
  const [open, setOpen] = createSignal(false);

  return (
    <SearchableMultiSelect
      options={props.facet.options}
      activeIds={props.facet.activeIds}
      onChange={props.facet.onChange}
      placeholder={props.facet.placeholder}
      placement="bottom-start"
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          queueMicrotask(() =>
            panel.panelRef()?.focus({ preventScroll: true })
          );
        }
      }}
    >
      <Combobox.Trigger class="inline-flex h-full items-center gap-1.5 px-2 hover:bg-hover active:bg-active">
        <ValueDisplay values={props.facet.values()} />
      </Combobox.Trigger>
    </SearchableMultiSelect>
  );
};

/**
 * Always-visible chip for one search facet: `label | value | ✕`. The ✕
 * resets the facet to its default and only renders while the facet is off
 * its default.
 */
export const SearchFacetChip = (props: SearchFacetChipProps) => (
  <Layer depth={2}>
    <div class="h-7 flex items-stretch text-xs whitespace-nowrap rounded-md bg-surface text-ink border border-edge-muted overflow-clip">
      <span class="inline-flex items-center px-2 text-ink-muted">
        {props.facet.label}
      </span>

      <ChipDivider />

      <Switch>
        <Match when={props.facet.kind === 'single' && props.facet}>
          {(facet) => (
            <SingleValueSegment
              facet={facet()}
              open={props.open}
              setOpen={props.setOpen}
            />
          )}
        </Match>
        <Match when={props.facet.kind === 'multi' && props.facet}>
          {(facet) => <MultiValueSegment facet={facet()} />}
        </Match>
      </Switch>

      <Show when={!props.facet.isDefault()}>
        <ChipDivider />
        <Button
          class="rounded-none h-full not-disabled:hover:text-failure"
          size="icon-sm"
          onClick={(e) => {
            e.stopPropagation();
            props.facet.reset();
          }}
        >
          <XIcon class="size-3.5!" />
        </Button>
      </Show>
    </div>
  </Layer>
);
