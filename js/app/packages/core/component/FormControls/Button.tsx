import type { HotkeyToken } from '@core/hotkey/tokens';
import { Polymorphic, type PolymorphicProps } from '@kobalte/core';
import {
  type JSX,
  type ParentComponent,
  Show,
  type ValidComponent,
} from 'solid-js';
import { Hotkey } from '../Hotkey';

type Size = 'SM' | 'Base' | 'XS';
type Theme = 'primary' | 'secondary' | 'primary' | 'secondary';

const sizeClass: Record<Size, string> = {
  XS: 'text-[10px] p-1',
  SM: 'text-xs p-1',
  Base: 'text-[14px] p-1 px-[8px]',
};
const themeClass: Record<Theme, string> = {
  primary: 'bg-ink text-panel',
  secondary: 'text-ink',
};

export const Button: ParentComponent<{
  size?: Size;
  theme?: Theme;
  active?: boolean;
  hotkeyToken?: HotkeyToken;
  hotkeyShortcut?: string;
  onClick?: PolymorphicProps<'button'>['onClick'];
  onMouseDown?: PolymorphicProps<'button'>['onMouseDown'];
  disabled?: boolean;
  border?: boolean;
  tabIndex?: number;
  classList?: JSX.CustomAttributes<HTMLButtonElement>['classList'];
  as?: ValidComponent;
  ref?: (ref: HTMLButtonElement) => void | HTMLButtonElement;
}> = (props) => {
  const hasHotkey = () => !!(props.hotkeyShortcut || props.hotkeyToken);
  return (
    <Polymorphic
      class="relative flex items-stretch hover:opacity-80 disabled:opacity-50 [&:focus]:[--focus-border-inset:-4px] font-mono font-medium uppercase leading-none disabled:cursor-not-allowed"
      classList={{
        [`${sizeClass[props.size || 'Base']}`]: !hasHotkey(),
        [`${themeClass[props.theme || 'primary']}`]: !hasHotkey(),
        'border-accent !bg-accent': props.active,
        '!text-panel': props.active && props.theme === 'secondary',
        'border-ink': !props.active,
        'border justify-center': !hasHotkey(),
        '!border-0': props.border === false,
        ...(props.classList ?? {}),
      }}
      onClick={props.onClick}
      onMouseDown={props.onMouseDown}
      disabled={props.disabled}
      tabIndex={props.tabIndex}
      as={props.as ?? 'button'}
      // as={'button'}
      ref={props.ref}
    >
      <Show
        when={props.hotkeyToken || props.hotkeyShortcut}
        fallback={props.children}
      >
        <div class="flex items-stretch">
          <div
            class="border"
            classList={{
              [`${sizeClass[props.size || 'Base']}`]: true,
              [`${themeClass[props.theme || 'primary']}`]: true,
              'border-accent !bg-accent': props.active,
              'border-ink': !props.active,
              '!border-0': props.border === false,
            }}
          >
            {props.children}
          </div>
          <div
            class="!p-[0px] border border-ink"
            classList={{
              [`${sizeClass[props.size || 'Base']}`]: true,
            }}
          >
            <Hotkey
              token={props.hotkeyToken}
              shortcut={props.hotkeyShortcut}
              class="border"
              classList={{
                [`${sizeClass[props.size || 'Base']}`]: true,
                'border-accent !bg-accent': props.active,
                'border-ink': !props.active,
                '!border-0': props.border === false,
              }}
            />
          </div>
        </div>
      </Show>
    </Polymorphic>
  );
};
