import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import type { HotkeyToken } from '@core/hotkey/tokens';
import type { JSXElement } from 'solid-js';

export type ActionButtonProps = {
  onClick?: (e: MouseEvent) => void;
  tooltip: string;
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
  ref?: (el: HTMLDivElement) => void;
  children: JSXElement;
  clicked?: boolean;
  darker?: boolean;
};

export function ActionButton(props: ActionButtonProps) {
  const handleClick = (e: MouseEvent) => {
    if (props.onClick) {
      e.stopPropagation();
      props.onClick(e);
    }
  };

  return (
    <Tooltip
      placement="top"
      floatingOptions={{ offset: 12 }}
      tooltip={
        <LabelAndHotKey
          label={props.tooltip}
          hotkeyToken={props.hotkeyToken}
          shortcut={props.shortcut}
        />
      }
      ref={props.ref}
    >
      <button
        class={`flex flex-col items-center justify-center h-[28px] w-[28px] hover:bg-hover hover-transition-bg ${props.clicked ? 'bg-active' : ''} rounded-md`}
        onClick={handleClick}
      >
        {props.children}
      </button>
    </Tooltip>
  );
}
