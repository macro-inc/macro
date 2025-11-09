import { ICON_SIZE_CLASSES } from '@core/component/EntityIcon';
import {
  FILE_LIST_ROW_HEIGHT,
  type FileListSize,
  TEXT_SIZE_CLASSES,
} from '@core/component/FileList/constants';
import { CaretSpacer } from '@core/component/FileList/ExplorerSpacer';
import { NewItemMenuItems } from '@core/component/FileList/NewItemMenu';
import { DropdownMenuContent } from '@core/component/Menu';
import Plus from '@icon/regular/plus.svg?component-solid';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { createSignal } from 'solid-js';

export function CreateNewItemButton(props: {
  parentId?: string;
  setIsCreatingProject: (isCreatingProject: boolean) => void;
  size: FileListSize;
  insideProjectBlock: boolean;
}) {
  const [isOpen, setIsOpen] = createSignal(false);
  return (
    <div
      class={`w-full flex flex-row items-center pl-2 hover:bg-hover hover-transition-bg ${isOpen() ? 'bg-active' : ''}`}
    >
      <CaretSpacer size={props.size} />
      <DropdownMenu open={isOpen()} onOpenChange={setIsOpen}>
        <DropdownMenu.Trigger
          class={`flex-1 flex flex-row items-center gap-1 ${FILE_LIST_ROW_HEIGHT[props.size]}`}
        >
          <Plus class={`${ICON_SIZE_CLASSES[props.size]} text-ink-muted`} />
          <span
            class={`flex-1 flex justify-start ${TEXT_SIZE_CLASSES[props.size]} text-ink-muted font-medium`}
          >
            Create new
          </span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenuContent class="z-action-menu" width="sm">
            <NewItemMenuItems
              setIsCreatingProject={props.setIsCreatingProject}
              parentId={props.parentId}
            />
          </DropdownMenuContent>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  );
}
