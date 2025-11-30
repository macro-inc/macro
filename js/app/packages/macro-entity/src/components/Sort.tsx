import ClockIcon from '@phosphor-icons/core/assets/regular/clock.svg';
import LightningIcon from '@phosphor-icons/core/assets/regular/lightning.svg';
import SortAscendingIcon from '@phosphor-icons/core/assets/regular/sort-ascending.svg';
import SortDescendingIcon from '@phosphor-icons/core/assets/regular/sort-descending.svg';
import { SegmentedControl } from 'core/component/FormControls/SegmentControls';
import { ToggleButton } from 'core/component/FormControls/ToggleButton';
import {
  type Accessor,
  type Component,
  createMemo,
  createSignal,
  type JSX,
  Show,
  type Signal,
} from 'solid-js';
import type { EntityComparator, EntityData } from '../types/entity';
import type { WithNotification } from '../types/notification';

export function Sort() {
  return <SegmentedControl list={['Notified', 'Updated', 'Viewed']} />;
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
    return false;
  });

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
            <SystemSortPills
              sortType={sortType}
              onSelect={setSortType}
              disabled={disabled}
            />
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
