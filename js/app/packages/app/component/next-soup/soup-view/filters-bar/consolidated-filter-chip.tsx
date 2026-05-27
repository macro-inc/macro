import { Combobox } from '@kobalte/core/combobox';
import CheckIcon from '@phosphor/check.svg';
import CirclesThreePlusIcon from '@phosphor/circles-three-plus.svg';
import XIcon from '@phosphor/x.svg';
import { Avatar, AvatarGroup, cn, Dropdown, Layer } from '@ui';
import {
  type Accessor,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import type { SearchableOption } from './search-filter-controls';
import { SearchableMultiSelect } from './searchable-multi-select';

const MAX_VISIBLE_ICONS = 3;

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
}

const ChipDivider = () => (
  <div class="w-px self-stretch bg-edge-muted shrink-0" />
);

const SingleValueDisplay = (props: { value: FilterValue }) => (
  <span class="inline-flex h-full items-center gap-1.5">
    <Show when={props.value.icon}>
      {(icon) => (
        <span class="size-3 flex items-center justify-center shrink-0">
          {icon()()}
        </span>
      )}
    </Show>
    <span class="truncate max-w-32">{props.value.label}</span>
  </span>
);

const MultiValueDisplay = (props: {
  values: FilterValue[];
  pluralLabel: string;
}) => {
  return (
    <span
      class="inline-flex h-full items-center gap-1.5"
      title={props.values.map((v) => v.label).join(', ')}
    >
      <CirclesThreePlusIcon class="size-3" />
      <span>
        {props.values.length} {props.pluralLabel}
      </span>
    </span>
  );
};

const AssigneeMultiValueDisplay = (props: { values: FilterValue[] }) => {
  const visibleValues = () => props.values.slice(0, MAX_VISIBLE_ICONS);
  const overflowCount = () =>
    Math.max(0, props.values.length - MAX_VISIBLE_ICONS);

  return (
    <span
      class="inline-flex items-center gap-1.5"
      title={props.values.map((v) => v.label).join(', ')}
    >
      <AvatarGroup size="sm">
        <For each={visibleValues()}>
          {(value) => (
            <Avatar size="sm">
              <Show when={value.icon}>{(icon) => icon()()}</Show>
            </Avatar>
          )}
        </For>
        <Show when={overflowCount() > 0}>
          <AvatarGroup.Count size="sm">+{overflowCount()}</AvatarGroup.Count>
        </Show>
      </AvatarGroup>
      <span>{props.values.length} Assignees</span>
    </span>
  );
};

const ValueDisplay = (props: {
  values: Accessor<FilterValue[]>;
  isAssignee?: boolean;
  pluralLabel: string;
}) => {
  const vals = () => props.values();
  const isSingle = () => vals().length === 1;

  return (
    <Switch>
      <Match when={isSingle()}>
        <SingleValueDisplay value={vals()[0]} />
      </Match>
      <Match when={props.isAssignee}>
        <AssigneeMultiValueDisplay values={vals()} />
      </Match>
      <Match when={!props.isAssignee}>
        <MultiValueDisplay values={vals()} pluralLabel={props.pluralLabel} />
      </Match>
    </Switch>
  );
};

const ValueDropdownContent = (props: {
  filter: ConsolidatedFilter;
  onClose: () => void;
}) => {
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
                onSelect={() => {
                  props.filter.onToggleValue?.(option.id);
                  if (!props.filter.multiple) {
                    props.onClose();
                  }
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

  const isAssignee = () => props.filter.key === 'assignee';
  const pluralLabel = () =>
    props.filter.categoryLabelPlural ?? `${props.filter.categoryLabel}s`;

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
          'hover:bg-hover active:bg-active',
          props.class
        )}
      >
        <ValueDisplay
          values={props.filter.values}
          isAssignee={isAssignee()}
          pluralLabel={pluralLabel()}
        />
      </Combobox.Trigger>
    </SearchableMultiSelect>
  );
};

const StandardValueSegment = (props: {
  filter: ConsolidatedFilter;
  class?: string;
}) => {
  const [open, setOpen] = createSignal(false);
  const hasOptions = () =>
    props.filter.availableOptions && props.filter.availableOptions.length > 0;

  const isAssignee = () => props.filter.key === 'assignee';
  const pluralLabel = () =>
    props.filter.categoryLabelPlural ?? `${props.filter.categoryLabel}s`;

  return (
    <Show
      when={hasOptions()}
      fallback={
        <span
          class={cn('inline-flex items-center gap-1.5 px-2.5', props.class)}
        >
          <ValueDisplay
            values={props.filter.values}
            isAssignee={isAssignee()}
            pluralLabel={pluralLabel()}
          />
        </span>
      }
    >
      <Dropdown open={open()} onOpenChange={setOpen}>
        <Dropdown.Trigger
          variant="ghost"
          class={cn(
            'inline-flex items-center gap-1.5 px-2.5 h-auto!',
            'hover:bg-ink/5 active:bg-ink/8 rounded-none',
            props.class
          )}
        >
          <ValueDisplay
            values={props.filter.values}
            isAssignee={isAssignee()}
            pluralLabel={pluralLabel()}
          />
        </Dropdown.Trigger>
        <ValueDropdownContent
          filter={props.filter}
          onClose={() => setOpen(false)}
        />
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
          'h-7 flex items-stretch text-xs whitespace-nowrap rounded-md',
          'bg-surface text-ink border border-edge-muted overflow-clip',
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

          <ChipDivider />
        </Show>

        {/* Value segment */}
        <Switch>
          <Match when={isSearchable()}>
            <SearchableValueSegment filter={props.filter} />
          </Match>
          <Match when={!isSearchable()}>
            <StandardValueSegment filter={props.filter} />
          </Match>
        </Switch>

        <ChipDivider />

        {/* Remove button */}
        <button
          type="button"
          class={cn(
            'inline-flex items-center justify-center px-1.5',
            'hover:bg-ink/5 active:bg-ink/8 hover:text-failure'
          )}
          onClick={(e) => {
            e.stopPropagation();
            props.filter.onRemoveAll();
          }}
        >
          <XIcon class="size-4" />
        </button>
      </div>
    </Layer>
  );
};
