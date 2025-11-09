import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import FunnelIcon from '@phosphor-icons/core/assets/regular/funnel-simple.svg';
import FunnelClearIcon from '@phosphor-icons/core/assets/regular/funnel-simple-x.svg';
import {
  DropdownMenuContent,
  MenuItem,
  MenuSeparator,
} from 'core/component/Menu';
import { TextButton } from 'core/component/TextButton';
import {
  createMemo,
  createSignal,
  type ParentProps,
  Show,
  splitProps,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  DEFAULT_FILTERS as defaultFilters,
  FilterContext,
  type FilterState,
  useFilterContext,
} from '../contexts/filter';
import { useUserId } from '../queries/auth';
import type { EntityData } from '../types/entity';
import type { Filters } from '../types/filter';
import type { WithNotification } from '../types/notification';
import { containsAllSameValues } from '../utils/arrayCompare';
import { FileTypeFilter } from './filters/FileType';
import { OwnerTypeFilter } from './filters/OwnerType';
import { UnreadSwitch } from './Unread';

export function Filter(props: ParentProps<FilterContext>) {
  const [localProps, filterContext] = splitProps(props, ['children']);

  return (
    <FilterContext.Provider value={filterContext}>
      <div class="flex flex-row items-center gap-2 px-2.5 py-1">
        {localProps.children}
      </div>
    </FilterContext.Provider>
  );
}

type CreateFilterContext = {
  [key in keyof Filters]?: FilterState[key] | Filters[key];
};
export function createFilter<
  T extends WithNotification<EntityData> = WithNotification<EntityData>,
>(context: CreateFilterContext = {}) {
  const filterContext = Object.entries(context).reduce<FilterContext>(
    (acc, [key, value]) => {
      if (Array.isArray(value) && typeof value[0] === 'function') {
        // @ts-expect-error
        acc[key] = value;
        // @ts-expect-error
        acc.defaultFilters[key] = value[0]();
      } else {
        // @ts-expect-error
        acc[key] = createSignal(value);
        // @ts-expect-error
        acc.defaultFilters[key] = value;
      }

      return acc;
    },
    { defaultFilters }
  );
  const [filterState, setFilterState] = createStore<FilterContext>({
    ...filterContext,
  });

  const resetFilter = () => setFilterState({ ...filterContext });

  const fileTypeFilter = createMemo(
    () => {
      const filter = filterState.fileTypeFilter?.[0]();
      if (!filter) return [];

      return filter;
    },
    [],
    { equals: containsAllSameValues }
  );

  const userId = useUserId();

  const filterFn = createMemo(
    () => {
      const unreadFilter = filterState.unreadFilter?.[0]();
      const ownerType = filterState.ownerTypeFilter?.[0]();
      const fileFilterArray = fileTypeFilter();
      return (entity: T) => {
        if (unreadFilter)
          return !!entity.notifications && entity.notifications().length > 0;

        if (ownerType && ownerType !== 'all') {
          return (ownerType === 'me') === (entity.ownerId === userId());
        }
        if (fileFilterArray.length > 0) {
          if (
            entity.type === 'document' &&
            entity.fileType &&
            !fileFilterArray.includes(entity.fileType.toLowerCase())
          )
            return false;
        }

        return true;
      };
    },
    undefined,
    { equals: false }
  );

  const FilterComponent = (props: ParentProps) => {
    return (
      <Filter {...filterState}>
        <Show when={filterState.unreadFilter}>
          {(unreadFilter) => (
            <UnreadSwitch
              checked={unreadFilter()[0]()}
              onChange={unreadFilter()[1]}
            />
          )}
        </Show>
        <Show when={filterState.fileTypeFilter}>
          <FileTypeFilter />
        </Show>
        <Show when={filterState.ownerTypeFilter}>
          <OwnerTypeFilter />
        </Show>
        {props.children}
        <FilterOptions onReset={resetFilter}>
          <Show when={filterContext.unreadFilter}>
            {(contextFilter) => (
              <MenuItem
                text="Unread Filter"
                selectorType="checkbox"
                checked={!!filterState.unreadFilter}
                onClick={() => {
                  const unreadFilter = filterState.unreadFilter;
                  if (unreadFilter) {
                    unreadFilter[1](false);
                    setFilterState('unreadFilter', undefined);
                  } else {
                    contextFilter()[1](true);
                    setFilterState('unreadFilter', contextFilter());
                  }
                }}
                closeOnSelect
              />
            )}
          </Show>
          <Show when={filterContext.fileTypeFilter}>
            {(contextFilter) => (
              <MenuItem
                text="FileType Filter"
                selectorType="checkbox"
                checked={!!filterState.fileTypeFilter}
                onClick={() => {
                  const fileTypeFilter = filterState.fileTypeFilter;
                  if (fileTypeFilter) {
                    setFilterState('fileTypeFilter', undefined);
                  } else {
                    setFilterState('fileTypeFilter', contextFilter());
                  }
                }}
                closeOnSelect
              />
            )}
          </Show>
          <Show when={filterContext.ownerTypeFilter}>
            {(contextFilter) => (
              <MenuItem
                text="OwnerType Filter"
                selectorType="checkbox"
                checked={!!filterState.ownerTypeFilter}
                onClick={() => {
                  const ownerTypeFilter = filterState.ownerTypeFilter;
                  if (ownerTypeFilter) {
                    setFilterState('ownerTypeFilter', undefined);
                  } else {
                    setFilterState('ownerTypeFilter', contextFilter());
                  }
                }}
                closeOnSelect
              />
            )}
          </Show>
        </FilterOptions>
      </Filter>
    );
  };

  return {
    FilterComponent,
    filterState,
    filterFn,
    resetFilter,
  };
}

interface FilterOptionsProps extends ParentProps {
  onReset?: () => void;
}
export function FilterOptions(props: FilterOptionsProps) {
  const filterContext = useFilterContext();
  const filterKeys = createMemo<Array<keyof FilterState>>(
    () =>
      Object.keys(filterContext).filter(
        (key) => key !== 'defaultFilters'
      ) as Array<keyof FilterState>,
    [],
    { equals: containsAllSameValues }
  );
  const hasFilters = createMemo(() =>
    filterKeys().some((key) => {
      const currentFilterValue = filterContext[key]?.[0]();
      const defaultValue = filterContext.defaultFilters[key];
      if (Array.isArray(currentFilterValue) && Array.isArray(defaultValue)) {
        return !containsAllSameValues(currentFilterValue, defaultValue);
      }

      return currentFilterValue !== defaultValue;
    })
  );

  const [isOpen, setIsOpen] = createSignal(false);
  return (
    <DropdownMenu open={isOpen()} onOpenChange={setIsOpen}>
      <DropdownMenu.Trigger
        class="flex items-center justify-end gap-2 px-1 align-middle"
        as="div"
      >
        <TextButton
          theme="clear"
          icon={FunnelIcon}
          class={`${hasFilters() ? 'text-accent-ink!' : ''} ${isOpen() ? 'bg-active!' : ''}`}
          tabIndex={-1}
          text="Filter"
        />
      </DropdownMenu.Trigger>
      <DropdownMenuContent>
        <MenuItem
          text="Reset To Default"
          icon={FunnelClearIcon}
          disabled={!hasFilters()}
          onClick={() => {
            props.onReset?.();
            filterKeys().forEach((key) =>
              // @ts-expect-error
              filterContext[key]?.[1](filterContext.defaultFilters[key])
            );
          }}
          closeOnSelect
        />
        <MenuSeparator />
        {props.children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
