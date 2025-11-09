import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import FileIcon from '@phosphor-icons/core/assets/regular/file-magnifying-glass.svg';
import FunnelClearIcon from '@phosphor-icons/core/assets/regular/funnel-simple-x.svg';
import {
  DropdownMenuContent,
  MenuItem,
  MenuSeparator,
} from 'core/component/Menu';
import { TextButton } from 'core/component/TextButton';
import { createMemo, createSelector, createSignal, For } from 'solid-js';
import { useFilterContext } from '../../contexts/filter';
import { containsAllSameValues } from '../../utils/arrayCompare';

const FILE_TYPE_FILTERS = ['MD', 'PDF', 'Canvas'];

export function FileTypeFilter() {
  const filterContext = useFilterContext();
  const fileTypeFilter = filterContext.fileTypeFilter;

  const hasFilters = createMemo(() => {
    const filter = fileTypeFilter?.[0]();
    if (!filter) return false;

    return !containsAllSameValues(
      filter,
      filterContext.defaultFilters.fileTypeFilter
    );
  });

  const fileTypeSelector = createSelector(
    fileTypeFilter?.[0] ?? (() => []),
    (fileType: string, filter) => filter.includes(fileType.toLowerCase())
  );

  const toggleFileTypeFilter = (fileType: string) => {
    fileTypeFilter?.[1](
      fileTypeSelector(fileType)
        ? fileTypeFilter?.[0]().filter((f) => f !== fileType.toLowerCase())
        : [...fileTypeFilter[0](), fileType.toLowerCase()]
    );
  };

  const [isOpen, setIsOpen] = createSignal(false);

  return (
    <DropdownMenu open={isOpen()} onOpenChange={setIsOpen}>
      <DropdownMenu.Trigger
        class="flex items-center justify-end gap-2 px-1 align-middle"
        as="div"
      >
        <TextButton
          theme="clear"
          icon={FileIcon}
          class={`${hasFilters() ? 'text-accent-ink!' : ''} ${isOpen() ? 'bg-active!' : ''}`}
          tabIndex={-1}
          text="FileType"
        />
      </DropdownMenu.Trigger>
      <DropdownMenuContent>
        <MenuItem
          text="Clear"
          icon={FunnelClearIcon}
          disabled={!hasFilters()}
          onClick={() => fileTypeFilter?.[1]([])}
          closeOnSelect
        />
        <MenuSeparator />
        <For each={FILE_TYPE_FILTERS}>
          {(fileType) => (
            <MenuItem
              text={fileType}
              selectorType="checkbox"
              checked={fileTypeSelector(fileType)}
              onClick={() => toggleFileTypeFilter(fileType)}
            />
          )}
        </For>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
