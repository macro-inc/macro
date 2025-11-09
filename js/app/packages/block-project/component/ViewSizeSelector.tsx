import { blockViewSize } from '@block-project/signal/view';
import { FILE_LIST_SIZE } from '@core/component/FileList/constants';
import { IconButton } from '@core/component/IconButton';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import Resize from '@icon/regular/resize.svg?component-solid';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { For } from 'solid-js';

const sizeLabels = {
  xs: 'Extra Small',
  sm: 'Small',
  md: 'Medium',
  lg: 'Large',
} as const;

export function ViewSizeSelector() {
  const size = blockViewSize.get;
  const setSize = blockViewSize.set;

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger>
        <IconButton size="sm" icon={Resize} theme="clear" tabIndex={-1} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenuContent>
          <DropdownMenu.RadioGroup>
            <For each={Object.entries(FILE_LIST_SIZE)}>
              {([key, value]) => (
                <MenuItem
                  selectorType="radio"
                  value={value}
                  groupValue={size()}
                  text={sizeLabels[key as keyof typeof FILE_LIST_SIZE]}
                  onClick={() => setSize(value)}
                />
              )}
            </For>
          </DropdownMenu.RadioGroup>
        </DropdownMenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
