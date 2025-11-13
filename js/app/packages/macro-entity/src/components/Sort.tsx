import { SegmentedControl } from 'core/component/FormControls/SegmentControls';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
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

  const SortComponent: SortComponent = (props) => (
    <SegmentedControl
      label="Sort"
      value={sortType()}
      onChange={setSortType}
      list={sortOptions}
      size={props.size}
      disabled={disabled?.()}
    />
  );

  return {
    SortComponent,
    sortFn,
  };
}
