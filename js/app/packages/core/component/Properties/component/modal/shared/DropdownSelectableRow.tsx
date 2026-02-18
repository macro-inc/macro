import { Hotkey } from '@core/component/Hotkey';
import type { JSX, ParentComponent } from 'solid-js';
import { Show } from 'solid-js';

type DropdownSelectableRowProps = {
  isSelected: boolean;
  dataIndex?: number;
  showHotkey?: boolean;
  hotkeyShortcut?: string;
  rightContent?: JSX.Element;
  onClick?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
  onMouseEnter?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
};

export const DropdownSelectableRow: ParentComponent<
  DropdownSelectableRowProps
> = (props) => {
  return (
    <div
      data-dropdown-index={props.dataIndex}
      class="flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2"
      classList={{
        'bg-hover': props.isSelected,
      }}
      onClick={props.onClick}
      onMouseEnter={props.onMouseEnter}
    >
      <div class="flex items-center gap-2 flex-1 min-w-0">{props.children}</div>
      <div class="flex items-center gap-2 flex-shrink-0">
        <Show when={props.showHotkey && props.hotkeyShortcut}>
          <div class="text-[0.625rem] px-1.5 py-0.5 border border-edge-muted text-ink-muted font-mono rounded-xs">
            <Hotkey shortcut={props.hotkeyShortcut!} />
          </div>
        </Show>
        {props.rightContent}
      </div>
    </div>
  );
};
