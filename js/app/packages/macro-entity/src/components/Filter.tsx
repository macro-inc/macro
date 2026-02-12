import { DeprecatedTextButton } from '@core/component/DeprecatedTextButton';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import FunnelIcon from '@phosphor-icons/core/assets/regular/funnel-simple.svg';
import FunnelClearIcon from '@phosphor-icons/core/assets/regular/funnel-simple-x.svg';
import {
  DropdownMenuContent,
  MenuItem,
  MenuSeparator,
} from 'core/component/Menu';
import {
  createMemo,
  createSignal,
  type ParentProps,
  splitProps,
} from 'solid-js';
import {
  FilterContext,
  type FilterState,
  useFilterContext,
} from '../contexts/filter';
import { containsAllSameValues } from '../utils/arrayCompare';

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
        <DeprecatedTextButton
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
