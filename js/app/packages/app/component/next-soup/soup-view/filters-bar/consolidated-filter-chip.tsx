import { Combobox } from '@kobalte/core/combobox';
import CheckIcon from '@phosphor/check.svg';
import XIcon from '@phosphor/x.svg';
import { Button, cn, Dropdown, Layer } from '@ui';
import {
  type Accessor,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import {
  SearchableMultiSelect,
  type SearchableOption,
} from './searchable-multi-select';

export type FilterValue = {
  id: string;
  label: string;
  icon?: () => JSX.Element;
};

export type ConsolidatedFilter = {
  /** Unique key for this filter group (e.g., 'status', 'type', 'in-channel') */
  key: string;
  /** Display label for the category (e.g., 'Status', 'Type', 'In') */
  categoryLabel: string;
  /** Plural form for multi-value display (e.g., 'Statuses', 'Types'). Falls back to categoryLabel + 's' */
  categoryLabelPlural?: string;
  /** Icon for the category */
  categoryIcon?: () => JSX.Element;
  /** Currently active values - accessor for reactivity */
  values: Accessor<FilterValue[]>;
  /** Available options for the value dropdown */
  availableOptions?: FilterValue[];
  /** Whether multiple values can be selected */
  multiple?: boolean;
  /** Remove a single value */
  onRemoveValue?: (valueId: string) => void;
  /** Remove all values (clear entire filter) */
  onRemoveAll: () => void;
  /** Toggle a value on/off */
  onToggleValue?: (valueId: string) => void;
  /** Check if a value is active */
  isValueActive?: (valueId: string) => boolean;

  // Searchable filter props (for In/From style filters)
  searchableOptions?: Accessor<SearchableOption[]>;
  activeSearchableIds?: Accessor<string[]>;
  onSearchableChange?: (ids: string[]) => void;
  searchPlaceholder?: string;
  isPopupOpen?: Accessor<boolean>;
  setPopupOpen?: (v: boolean) => void;
};

interface ConsolidatedFilterChipProps {
  filter: ConsolidatedFilter;
  class?: string;
  hideCategoryLabel?: boolean;
  mobile?: boolean;
}

const ChipDivider = (props: { mobile?: boolean }) => (
  <Show when={!props.mobile}>
    <div class="w-px self-stretch bg-edge-muted shrink-0" />
  </Show>
);

const SingleValueDisplay = (props: { value: FilterValue }) => (
  <span class="inline-flex h-full items-center gap-1.5">
    <Show when={props.value.icon}>
      {(icon) => (
        <span class="size-4 flex items-center justify-center shrink-0">
          {icon()()}
        </span>
      )}
    </Show>
    <span class="truncate max-w-32">{props.value.label}</span>
  </span>
);

const MultiValueDisplay = (props: { values: FilterValue[] }) => {
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

/** People filter keys that should show avatar stacks */
const PEOPLE_FILTER_KEYS = new Set(['assignee', 'channel-from', 'call-from']);

const PeopleMultiValueDisplay = (props: { values: FilterValue[] }) => {
  const first = () => props.values[0];
  const overflowCount = () => props.values.length - 1;

  return (
    <span
      class="inline-flex items-center gap-1.5"
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

const ValueDisplay = (props: {
  values: Accessor<FilterValue[]>;
  isPeopleFilter?: boolean;
}) => {
  const vals = () => props.values();
  const isSingle = () => vals().length === 1;

  return (
    <Switch>
      <Match when={isSingle()}>
        <SingleValueDisplay value={vals()[0]} />
      </Match>
      <Match when={props.isPeopleFilter}>
        <PeopleMultiValueDisplay values={vals()} />
      </Match>
      <Match when={!props.isPeopleFilter}>
        <MultiValueDisplay values={vals()} />
      </Match>
    </Switch>
  );
};

const ValueDropdownContent = (props: { filter: ConsolidatedFilter }) => {
  const isActive = (id: string) =>
    props.filter.isValueActive?.(id) ??
    props.filter.values().some((v) => v.id === id);

  return (
    <Dropdown.Content>
      <Dropdown.Group>
        <For each={props.filter.availableOptions}>
          {(option) => {
            const active = () => isActive(option.id);
            return (
              <Dropdown.Item
                closeOnSelect={!props.filter.multiple}
                onSelect={() => {
                  props.filter.onToggleValue?.(option.id);
                }}
              >
                <Show
                  when={props.filter.multiple}
                  fallback={
                    <span
                      class={cn(
                        'size-4 flex items-center justify-center shrink-0 rounded-full border',
                        active() ? 'bg-accent border-accent' : 'border-edge'
                      )}
                    >
                      <Show when={active()}>
                        <CheckIcon class="size-2.5 text-surface" />
                      </Show>
                    </span>
                  }
                >
                  <span
                    class={cn(
                      'size-4 flex items-center justify-center shrink-0 rounded border',
                      active() ? 'bg-accent border-accent' : 'border-edge'
                    )}
                  >
                    <Show when={active()}>
                      <CheckIcon class="size-2.5 text-surface" />
                    </Show>
                  </span>
                </Show>

                <Show when={option.icon}>
                  {(icon) => (
                    <span class="size-4 flex items-center justify-center shrink-0">
                      {icon()()}
                    </span>
                  )}
                </Show>

                <span
                  class={cn(
                    'flex-1 truncate',
                    active() ? 'text-ink' : 'text-ink-muted'
                  )}
                >
                  {option.label}
                </span>
              </Dropdown.Item>
            );
          }}
        </For>
      </Dropdown.Group>
    </Dropdown.Content>
  );
};

const SearchableValueSegment = (props: {
  filter: ConsolidatedFilter;
  class?: string;
  mobile?: boolean;
}) => {
  const options: Accessor<SearchableOption[]> = () =>
    props.filter.searchableOptions?.() ?? [];
  const activeIds: Accessor<string[]> = () =>
    props.filter.activeSearchableIds?.() ?? [];

  const handleChange = (ids: string[]) => {
    props.filter.onSearchableChange?.(ids);
  };

  const placeholder =
    props.filter.searchPlaceholder ??
    `Search ${props.filter.categoryLabel.toLowerCase()}...`;

  const isPeopleFilter = () => PEOPLE_FILTER_KEYS.has(props.filter.key);

  return (
    <SearchableMultiSelect
      options={options}
      activeIds={activeIds}
      onChange={handleChange}
      placeholder={placeholder}
      placement="bottom-start"
      open={props.filter.isPopupOpen}
      onOpenChange={(v) => props.filter.setPopupOpen?.(v)}
    >
      <Combobox.Trigger
        class={cn(
          'inline-flex h-full items-center gap-1.5 px-2',
          props.mobile
            ? 'bg-active hover:bg-active active:bg-active px-3'
            : 'hover:bg-hover active:bg-active',
          props.class
        )}
      >
        <ValueDisplay
          values={props.filter.values}
          isPeopleFilter={isPeopleFilter()}
        />
      </Combobox.Trigger>
    </SearchableMultiSelect>
  );
};

const StandardValueSegment = (props: {
  filter: ConsolidatedFilter;
  class?: string;
  mobile?: boolean;
}) => {
  const [open, setOpen] = createSignal(false);
  const hasOptions = () =>
    props.filter.availableOptions && props.filter.availableOptions.length > 0;

  const isPeopleFilter = () => PEOPLE_FILTER_KEYS.has(props.filter.key);

  return (
    <Show
      when={hasOptions()}
      fallback={
        <span
          class={cn(
            'inline-flex items-center gap-1.5 px-2.5',
            props.mobile && 'bg-active px-3',
            props.class
          )}
        >
          <ValueDisplay
            values={props.filter.values}
            isPeopleFilter={isPeopleFilter()}
          />
        </span>
      }
    >
      <Dropdown open={open()} onOpenChange={setOpen}>
        <Dropdown.Trigger
          variant="ghost"
          class={cn(
            'inline-flex items-center gap-1.5 px-2.5 h-auto!',
            props.mobile
              ? 'bg-active hover:bg-active active:bg-active rounded-none px-3'
              : 'hover:bg-ink/5 active:bg-ink/8 rounded-none',
            props.class
          )}
        >
          <ValueDisplay
            values={props.filter.values}
            isPeopleFilter={isPeopleFilter()}
          />
        </Dropdown.Trigger>
        <ValueDropdownContent filter={props.filter} />
      </Dropdown>
    </Show>
  );
};

export const ConsolidatedFilterChip = (props: ConsolidatedFilterChipProps) => {
  const isSearchable = () => Boolean(props.filter.searchableOptions);

  return (
    <Layer depth={2}>
      <div
        class={cn(
          props.mobile ? 'h-10' : 'h-7',
          'flex items-stretch text-xs whitespace-nowrap rounded-md',
          'bg-surface text-ink border border-edge-muted overflow-clip',
          props.mobile && 'bg-active border-none rounded-lg',
          props.class
        )}
      >
        <Show when={!props.hideCategoryLabel}>
          <span class="inline-flex items-center gap-1.5 px-2 text-ink-muted">
            <Show when={props.filter.categoryIcon}>
              {(icon) => (
                <span class="size-3 flex items-center justify-center shrink-0">
                  {icon()()}
                </span>
              )}
            </Show>
            <span>{props.filter.categoryLabel}</span>
          </span>

          <ChipDivider mobile={props.mobile} />
        </Show>

        {/* Value segment */}
        <Switch>
          <Match when={isSearchable()}>
            <SearchableValueSegment
              filter={props.filter}
              mobile={props.mobile}
            />
          </Match>
          <Match when={!isSearchable()}>
            <StandardValueSegment filter={props.filter} mobile={props.mobile} />
          </Match>
        </Switch>

        <ChipDivider mobile={props.mobile} />

        <Button
          class={cn(
            'rounded-none h-full not-disabled:hover:text-failure',
            props.mobile && 'bg-active border-none'
          )}
          size="icon-sm"
          onClick={(e) => {
            e.stopPropagation();
            props.filter.onRemoveAll();
          }}
        >
          <XIcon class="size-3.5!" />
        </Button>
      </div>
    </Layer>
  );
};
