import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import FunnelClearIcon from '@phosphor-icons/core/assets/regular/funnel-simple-x.svg';
import UserSwitchIcon from '@phosphor-icons/core/assets/regular/user-switch.svg';
import {
  DropdownMenuContent,
  MenuItem,
  MenuSeparator,
} from 'core/component/Menu';
import { TextButton } from 'core/component/TextButton';
import { createMemo, createSignal } from 'solid-js';
import { useFilterContext } from '../../contexts/filter';

export function OwnerTypeFilter() {
  const filterContext = useFilterContext();
  const ownerTypeFilter = filterContext.ownerTypeFilter;

  const hasFilters = createMemo(() => {
    const filter = ownerTypeFilter?.[0]();
    if (!filter) return false;

    return filter !== filterContext.defaultFilters.ownerTypeFilter;
  });

  const [isOpen, setIsOpen] = createSignal(false);

  return (
    <DropdownMenu open={isOpen()} onOpenChange={setIsOpen}>
      <DropdownMenu.Trigger
        class="flex items-center justify-end gap-2 px-1 align-middle"
        as="div"
      >
        <TextButton
          theme="clear"
          icon={UserSwitchIcon}
          class={`${hasFilters() ? 'text-accent-ink!' : ''} ${isOpen() ? 'bg-active!' : ''}`}
          tabIndex={-1}
          text="OwnerType"
        />
      </DropdownMenu.Trigger>
      <DropdownMenuContent>
        <MenuItem
          text="Reset"
          icon={FunnelClearIcon}
          disabled={!hasFilters()}
          onClick={() => ownerTypeFilter?.[1]('all')}
          closeOnSelect
        />
        <MenuSeparator />
        <DropdownMenu.RadioGroup
          value={ownerTypeFilter?.[0]() ?? 'all'}
          onChange={(value) => ownerTypeFilter?.[1](value)}
        >
          <MenuItem
            text="All"
            selectorType="radio"
            value="all"
            groupValue={ownerTypeFilter?.[0]() ?? 'all'}
            closeOnSelect
          />
          <MenuItem
            text="Me"
            selectorType="radio"
            value="me"
            groupValue={ownerTypeFilter?.[0]() ?? 'all'}
            closeOnSelect
          />
          <MenuItem
            text="Others"
            selectorType="radio"
            value="other"
            groupValue={ownerTypeFilter?.[0]() ?? 'all'}
            closeOnSelect
          />
        </DropdownMenu.RadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
