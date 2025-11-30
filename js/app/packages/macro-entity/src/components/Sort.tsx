import ClockIcon from '@phosphor-icons/core/assets/regular/clock.svg';
import LightningIcon from '@phosphor-icons/core/assets/regular/lightning.svg';
import SortAscendingIcon from '@phosphor-icons/core/assets/regular/sort-ascending.svg';
import SortDescendingIcon from '@phosphor-icons/core/assets/regular/sort-descending.svg';
import { propertiesServiceClient } from '@service-properties/client';
import { SegmentedControl } from 'core/component/FormControls/SegmentControls';
import { ToggleButton } from 'core/component/FormControls/ToggleButton';
import type { PropertyDefinitionFlat } from 'core/component/Properties/types';
import { PropertyDataTypeIcon } from 'core/component/Properties/utils/PropertyDataTypeIcon';
import { isErr } from 'core/util/maybeResult';
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
  type Signal,
} from 'solid-js';

import type { EntityComparator, EntityData } from '../types/entity';
import type { WithNotification } from '../types/notification';

export function Sort() {
  return <SegmentedControl list={['Notified', 'Updated', 'Viewed']} />;
}

type PropertySortSearchProps = {
  onSelectProperty?: (property: PropertyDefinitionFlat) => void;
};

function PropertySortSearch(props: PropertySortSearchProps) {
  const [availableProperties, setAvailableProperties] = createSignal<
    PropertyDefinitionFlat[]
  >([]);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [isDropdownOpen, setIsDropdownOpen] = createSignal(false);

  let searchInputRef!: HTMLInputElement;
  let dropdownRef!: HTMLDivElement;
  let containerRef!: HTMLDivElement;

  const fetchAvailableProperties = async () => {
    try {
      const result = await propertiesServiceClient.listProperties({
        scope: 'all',
        include_options: false,
      });

      if (isErr(result)) {
        return;
      }

      const [, data] = result;
      const properties = Array.isArray(data) ? data : [];
      setAvailableProperties(properties);
    } catch (_apiError) {
      // Silently fail
    }
  };

  // Filter to only sortable properties
  const sortableProperties = createMemo(() => {
    return availableProperties().filter((property) => {
      if (
        ['BOOLEAN', 'ENTITY', 'LINK', 'STRING'].includes(property.data_type) ||
        property.is_multi_select
      )
        return false;
      return true;
    });
  });

  const filteredProperties = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    const properties = sortableProperties();

    if (!query) return properties;

    return properties.filter((property) => {
      const name = property.display_name.toLowerCase();
      return name.includes(query);
    });
  });

  const handleSelectProperty = (property: PropertyDefinitionFlat) => {
    props.onSelectProperty?.(property);
    setSearchQuery('');
    setIsDropdownOpen(false);
  };

  onMount(() => {
    fetchAvailableProperties();
  });

  // Close dropdown when clicking outside
  createEffect(() => {
    if (!isDropdownOpen()) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      const isInsideContainer = containerRef?.contains(target);
      const isInsideDropdown = dropdownRef?.contains(target);

      if (!isInsideContainer && !isInsideDropdown) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    onCleanup(() => {
      document.removeEventListener('mousedown', handleClickOutside);
    });
  });

  return (
    <div ref={containerRef} class="relative w-full">
      <input
        ref={searchInputRef}
        type="text"
        value={searchQuery()}
        onInput={(e) => {
          setSearchQuery(e.currentTarget.value);
          setIsDropdownOpen(true);
        }}
        onFocus={() => setIsDropdownOpen(true)}
        placeholder="Search Properties..."
        class="w-full px-2 py-1 font-mono text-xs text-ink placeholder-ink-muted bg-transparent border border-edge focus:ring-2 focus:ring-accent/50 focus:border-accent"
      />
      <Show when={isDropdownOpen()}>
        <div
          ref={dropdownRef}
          class="absolute left-0 right-0 top-full mt-1 z-[100] border border-edge bg-menu shadow-lg max-h-48 overflow-y-auto font-mono"
        >
          <Show
            when={filteredProperties().length > 0}
            fallback={
              <div class="px-3 py-2 text-xs text-ink-muted text-center">
                No sortable properties found
              </div>
            }
          >
            <For each={filteredProperties()}>
              {(property) => (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelectProperty(property);
                  }}
                  class="w-full px-2 py-1.5 text-xs text-ink hover:bg-hover flex items-center gap-2 text-left"
                >
                  <PropertyDataTypeIcon property={property} />
                  <span class="truncate flex-1">{property.display_name}</span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}

type DefaultSortType = 'important' | 'updatedAt' | 'viewedAt' | 'frecency';

export type SortOption<
  T extends EntityData,
  S extends string = DefaultSortType,
> = {
  value: S;
  label: string;
  sortFn: EntityComparator<T>;
};

export function notifiedSortFn<T extends WithNotification<EntityData>>(
  a: T,
  b: T
) {
  const aNotification = a.notifications?.()[0];
  const bNotification = b.notifications?.()[0];

  if (aNotification && bNotification) {
    if (aNotification.isImportantV0 && bNotification.isImportantV0) {
      return bNotification.createdAt - aNotification.createdAt;
    } else if (aNotification.isImportantV0) {
      return -1;
    } else if (bNotification.isImportantV0) {
      return 1;
    }

    return bNotification.createdAt - aNotification.createdAt;
  } else if (aNotification) {
    return -1;
  } else if (bNotification) {
    return 1;
  }

  return sortByUpdatedAt(a, b);
}

export function sortByCreatedAt<T extends EntityData>(a: T, b: T): number {
  return (b.createdAt ?? 0) - (a.createdAt ?? 0);
}

export function sortByUpdatedAt<T extends EntityData>(a: T, b: T) {
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
}

export function sortByViewedAt<T extends EntityData>(a: T, b: T) {
  return (b.viewedAt ?? 0) - (a.viewedAt ?? 0);
}

export function sortByFrecencyScore<T extends EntityData>(a: T, b: T): number {
  return (b.frecencyScore ?? 0) - (a.frecencyScore ?? 0);
}

export const defaultSortOptions: SortOption<WithNotification<EntityData>>[] = [
  { value: 'important', label: 'Important', sortFn: notifiedSortFn },
  { value: 'updatedAt', label: 'Updated', sortFn: sortByUpdatedAt },
  { value: 'viewedAt', label: 'Viewed', sortFn: sortByViewedAt },
  { value: 'frecency', label: 'Frecency', sortFn: sortByFrecencyScore },
];

type InferSortFn<Options extends SortOption<any, string>[]> =
  Options[number] extends SortOption<infer U, string>
    ? EntityComparator<U>
    : never;

type SortComponent = (props: { size?: 'SM' | 'Base' }) => JSX.Element;

export function createSort(): {
  sortFn: Accessor<EntityComparator<WithNotification<EntityData>>>;
  SortComponent: SortComponent;
};
export function createSort<Options extends SortOption<EntityData>[]>(context: {
  sortOptions: Options;
  defaultSortOption: Options[number]['value'];
}): {
  sortFn: Accessor<InferSortFn<Options>>;
  SortComponent: SortComponent;
};
export function createSort<T extends EntityData, S extends string>(context: {
  sortOptions: SortOption<T, S>[];
  defaultSortOption: S;
}): {
  sortFn: Accessor<InferSortFn<SortOption<T, S>[]>>;
  SortComponent: SortComponent;
};
export function createSort<T extends EntityData, S extends string>(context: {
  sortOptions: SortOption<T, S>[];
  sortTypeSignal: Signal<S>;
  disabled?: Accessor<boolean>;
}): {
  sortFn: Accessor<InferSortFn<SortOption<T, S>[]>>;
  SortComponent: SortComponent;
};
export function createSort<
  Options extends SortOption<any, string>[],
>(context?: {
  sortOptions: Options;
  defaultSortOption?: Options[number]['value'];
  sortTypeSignal?: Signal<Options[number]['value']>;
  disabled?: Accessor<boolean>;
}): {
  sortFn: Accessor<InferSortFn<Options>>;
  SortComponent: SortComponent;
} {
  const { sortOptions, defaultSortOption, disabled } = {
    sortOptions: defaultSortOptions,
    defaultSortOption: 'important',
    ...context,
  };
  const [sortType, setSortType] =
    context?.sortTypeSignal ??
    createSignal<Options[number]['value']>(defaultSortOption);

  const sortFn = createMemo<InferSortFn<Options>>(() => {
    const sortBy = sortType();
    const sortFn = sortOptions.find(
      (option) => option.value === sortBy
    )?.sortFn;
    if (!sortFn) {
      console.error(`Sort function for ${sortBy} not found`);
      return ((_, __) => 0) as InferSortFn<Options>;
    }

    return sortFn as InferSortFn<Options>;
  });

  const [sortOrder, setSortOrder] = createSignal<'ascending' | 'descending'>(
    'descending'
  );

  const isSortProperty = createMemo(() => {
    // TODO: Implement isSortProperty
    return false;
  });

  const handleSelectProperty = (_property: PropertyDefinitionFlat) => {
    // TODO: Implement property selection
  };

  type SystemSortPillsProps = {
    sortType: Accessor<string>;
    onSelect: (value: string) => void;
    disabled?: Accessor<boolean>;
  };

  const SystemSortPills: Component<SystemSortPillsProps> = (props) => {
    const pillClass =
      'inline-flex w-fit min-h-[24px] items-center gap-1.5 px-2 py-1 text-xs font-mono border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

    return (
      <div class="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => props.onSelect('viewed_at')}
          disabled={props.disabled?.()}
          class={pillClass}
          classList={{
            'bg-ink text-panel border-ink': props.sortType() === 'viewed_at',
            'bg-transparent text-ink border-edge hover:bg-hover':
              props.sortType() !== 'viewed_at',
          }}
        >
          <ClockIcon class="size-3.5" />
          Viewed
        </button>
        <button
          type="button"
          onClick={() => props.onSelect('updated_at')}
          disabled={props.disabled?.()}
          class={pillClass}
          classList={{
            'bg-ink text-panel border-ink': props.sortType() === 'updated_at',
            'bg-transparent text-ink border-edge hover:bg-hover':
              props.sortType() !== 'updated_at',
          }}
        >
          <ClockIcon class="size-3.5" />
          Updated
        </button>
        <button
          type="button"
          onClick={() => props.onSelect('created_at')}
          disabled={props.disabled?.()}
          class={pillClass}
          classList={{
            'bg-ink text-panel border-ink': props.sortType() === 'created_at',
            'bg-transparent text-ink border-edge hover:bg-hover':
              props.sortType() !== 'created_at',
          }}
        >
          <ClockIcon class="size-3.5" />
          Created
        </button>
        <button
          type="button"
          onClick={() => props.onSelect('frecency')}
          disabled={props.disabled?.()}
          class={pillClass}
          classList={{
            'bg-ink text-panel border-ink': props.sortType() === 'frecency',
            'bg-transparent text-ink border-edge hover:bg-hover':
              props.sortType() !== 'frecency',
          }}
        >
          <LightningIcon class="size-3.5" />
          Frecency
        </button>
      </div>
    );
  };

  const SortComponent: SortComponent = (_props) => (
    <div class="flex flex-col gap-2">
      <span class="text-xs font-medium">Sort</span>
      <div class="flex items-center justify-between gap-2">
        <Show
          when={isSortProperty()}
          fallback={
            <div class="flex flex-col w-full gap-2">
              <SystemSortPills
                sortType={sortType}
                onSelect={setSortType}
                disabled={disabled}
              />
              <PropertySortSearch onSelectProperty={handleSelectProperty} />
            </div>
          }
        >
          <div class="flex">
            <ToggleButton
              size="SM"
              pressed={sortOrder() === 'descending'}
              onChange={() => setSortOrder('descending')}
            >
              <SortDescendingIcon class="size-4" />
            </ToggleButton>
            <ToggleButton
              size="SM"
              pressed={sortOrder() === 'ascending'}
              onChange={() => setSortOrder('ascending')}
            >
              <SortAscendingIcon class="size-4" />
            </ToggleButton>
          </div>
        </Show>
      </div>
    </div>
  );

  return {
    SortComponent,
    sortFn,
  };
}
