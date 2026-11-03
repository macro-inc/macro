import type { TagFilterMode } from '@app/features/next-soup/filters/filter-store/types';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import XIcon from '@icon/system/regular/x.svg';
import { Combobox } from '@kobalte/core/combobox';
import { ButtonGroup, Dropdown, Layer, SingleSelectCheck } from '@ui';
import {
  type Accessor,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { SearchableMultiSelect } from '../searchable-multi-select';
import type { FacetModeVM, FacetOption, SearchFacetVM } from './search-facets';

interface SearchFacetChipProps {
  facet: SearchFacetVM;
  open?: Accessor<boolean>;
  setOpen?: (v: boolean) => void;
  onPickerClose?: () => void;
}

const ValueDisplay = (props: { values: FacetOption[] }) => {
  const first = () => props.values[0];
  const overflowCount = () => props.values.length - 1;

  return (
    <span
      class="inline-flex min-w-0 items-center gap-1.5"
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
        <span class="inline-flex items-center justify-center px-1 min-w-4 h-4 rounded-full bg-active text-xxs">
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
      <Dropdown.Trigger as={ButtonGroup.Button} variant="ghost" size="xs">
        <ValueDisplay values={props.facet.values()} />
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local">
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

const MODE_OPTIONS: { id: TagFilterMode; label: string }[] = [
  { id: 'any', label: 'any of' },
  { id: 'all', label: 'all of' },
];

const ModeSegment = (props: { mode: FacetModeVM }) => (
  <Dropdown>
    <Dropdown.Trigger as={ButtonGroup.Button} variant="ghost" size="xs">
      {MODE_OPTIONS.find((o) => o.id === props.mode.value())?.label}
    </Dropdown.Trigger>
    <Dropdown.Content portalScope="local">
      <Dropdown.Group>
        <For each={MODE_OPTIONS}>
          {(option) => (
            <Dropdown.Item
              onSelect={() => props.mode.onSelect(option.id)}
              closeOnSelect
            >
              <span class="flex-1 truncate">{option.label}</span>
              <SingleSelectCheck active={props.mode.value() === option.id} />
            </Dropdown.Item>
          )}
        </For>
      </Dropdown.Group>
    </Dropdown.Content>
  </Dropdown>
);

const MultiValueSegment = (props: {
  onPickerClose?: () => void;
  facet: Extract<SearchFacetVM, { kind: 'multi' }>;
}) => {
  const panel = useSplitPanel();
  const [open, setOpen] = createSignal(false);

  return (
    <SearchableMultiSelect
      portalScope="local"
      options={props.facet.options}
      activeIds={props.facet.activeIds}
      onChange={props.facet.onChange}
      onOnly={props.facet.onOnly}
      placeholder={props.facet.placeholder}
      preserveOrder={props.facet.preserveOrder}
      placement="bottom-start"
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          queueMicrotask(() =>
            props.onPickerClose
              ? props.onPickerClose()
              : panel?.panelRef()?.focus({ preventScroll: true })
          );
        }
      }}
    >
      <Combobox.Trigger
        as={ButtonGroup.Button}
        variant="ghost"
        size="xs"
        aria-label={`Change ${props.facet.label} filter`}
      >
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
    <ButtonGroup aria-label={props.facet.label} size="xs" class="shrink-0">
      <span class="inline-flex items-center px-2 text-xs text-ink-muted">
        {props.facet.label}
      </span>

      <ButtonGroup.Divider />

      <Show
        when={
          props.facet.kind === 'multi' &&
          props.facet.mode?.visible() &&
          props.facet.mode
        }
      >
        {(mode) => (
          <>
            <ModeSegment mode={mode()} />
            <ButtonGroup.Divider />
          </>
        )}
      </Show>

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
          {(facet) => (
            <MultiValueSegment
              facet={facet()}
              onPickerClose={props.onPickerClose}
            />
          )}
        </Match>
      </Switch>

      <Show when={!props.facet.isDefault()}>
        <ButtonGroup.Divider />
        <ButtonGroup.Button
          variant="ghost"
          aria-label={`Clear ${props.facet.label} filter`}
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            props.facet.reset();
          }}
        >
          <XIcon class="size-3.5" />
        </ButtonGroup.Button>
      </Show>
    </ButtonGroup>
  </Layer>
);
