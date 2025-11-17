import { IS_MAC } from '@core/constant/isMac';
import { useTokenToHotkeyString } from '@core/hotkey/hotkeys';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { createMemo, For, type JSX, Show, splitProps } from 'solid-js';
import type { Theme } from './Themes';
import { prettyPrintHotkeyString } from '@core/hotkey/utils';
import { ValidHotkey } from '@core/hotkey/types';

const modifierMap = {
  cmd: IS_MAC ? '⌘' : 'Ctrl',
  opt: IS_MAC ? '⌥' : 'Alt',
  shift: IS_MAC ? '⇧' : 'Shift',
  ctrl: IS_MAC ? '⌃' : 'Ctrl',
  meta: IS_MAC ? '⌘' : 'Ctrl',
} as const;

const symbolMap = {
  ARROWUP: '↑',
  ARROWDOWN: '↓',
  ARROWLEFT: '←',
  ARROWRIGHT: '→',
  ENTER: '↵',
  SPACE: 'Space',
  BACKSPACE: '⌫',
  DELETE: '⌦',
  ESCAPE: 'ESC',
};

export const hotkeyStyles: Record<Theme, { label: string; hotkey: string }> = {
  base: {
    label: 'bg-ink border border-ink text-dialog',
    hotkey: 'bg-dialog border border-ink text-ink',
  },
  accent: {
    label: 'bg-accent border border-accent/30 text-dialog',
    hotkey: 'bg-accent/10 border border-accent/30 text-accent',
  },
  accentFill: {
    label: 'bg-accent border border-accent text-dialog',
    hotkey: 'bg-dialog border border-accent text-accent',
  },
  accentOpaque: {
    label: '',
    hotkey: '',
  },
  contrast: {
    label: '',
    hotkey: '',
  },
  clear: {
    label: '',
    hotkey: '',
  },
  selected: {
    label: '',
    hotkey: '',
  },
  green: {
    label: '',
    hotkey: '',
  },
  red: {
    label: '',
    hotkey: '',
  },
  muted: {
    label: 'bg-ink-muted border border-ink-muted text-dialog',
    hotkey: 'bg-dialog border border-ink-muted text-ink-muted',
  },
  extraMuted: {
    label: 'bg-ink-extra-muted border border-ink-extra-muted text-dialog',
    hotkey: 'bg-dialog border border-ink-extra-muted text-ink-extra-muted',
  },
  disabled: {
    label: 'bg-ink-disabled border border-ink-disabled text-dialog',
    hotkey: 'bg-dialog border border-ink-disabled text-ink-disabled',
  },
  reverse: {
    label: 'bg-dialog border border dialog text-ink',
    hotkey: 'bg-ink border border-dialog text-dialog',
  },
  current: {
    label: 'bg-current border border-current text-dialog',
    hotkey: 'bg-dialog border border-current text-current',
  },
};

const getSymbol = (key: string) =>
  key in symbolMap ? symbolMap[key as keyof typeof symbolMap] : key;

const modifierKeys = Object.keys(modifierMap);

function breakApartHotkeyString(hotkey: string) {
  const parts = hotkey.split('+');
  if (parts.length === 0) {
    return { key: '', modifiers: [] };
  }
  const key = parts
    .filter((part) => !modifierKeys.includes(part))
    .map(getSymbol);
  const modifiers = parts.filter((part) => modifierKeys.includes(part));
  return { key, modifiers };
}

interface HotkeyProps extends JSX.HTMLAttributes<HTMLDivElement> {
  token?: HotkeyToken;
  shortcut?: ValidHotkey;
  showPlus?: boolean; // Whether to show the plus sign in compound hotkeys
  lowercase?: boolean; // Whether to display the key in lowercase
}

/**
 * A component that displays a hotkey for either: 1) a given hotkey token, as registered in the hotkey registry or 2) a shortcut string (e.g. 'cmd+c').
 * @param props.token - The hotkey registry token to display the hotkey for.
 * @param props.shortcut - The shortcut string to display the hotkey for.
 * @example
 * <Hotkey token="canvas.cut" />
 */
export const Hotkey = (props: HotkeyProps) => {
  const [local, rest] = splitProps(props, [
    'token',
    'shortcut',
    'showPlus',
    'children',
    'lowercase',
  ]);
  const tokenShortcut = local.token
    ? useTokenToHotkeyString(local.token)
    : () => undefined;

  const hotkey = createMemo(() => {
    const tokenShortcut_ = tokenShortcut();
    // fallback for when we specify a shortcut directly instead of a hotkey token
    if (local.shortcut && !tokenShortcut_) {
      return breakApartHotkeyString(prettyPrintHotkeyString(local.shortcut) ?? '');
    }
    if (!tokenShortcut_) {
      return { key: '', modifiers: [] };
    }
    return breakApartHotkeyString(tokenShortcut_);
  });

  const normalizedKey = () => {
    const key = hotkey().key;
    return props.lowercase
      ? typeof key === 'string'
        ? key.toLowerCase()
        : key.map((k) => k.toLowerCase())
      : typeof key === 'string'
        ? key.toUpperCase()
        : key.map((k) => k.toUpperCase());
  };

  return (
    <div {...rest}>
      <For each={hotkey().modifiers}>
        {(mod) => (
          <>
            <span class="text-current">
              {modifierMap[mod as keyof typeof modifierMap] || mod}
            </span>

            <Show when={local.showPlus}>
              <span class="text-current">+</span>
            </Show>
          </>
        )}
      </For>
      <Show when={normalizedKey()}>
        <span class="text-current">{normalizedKey()}</span>
      </Show>
    </div>
  );
};

// Created for backwards compatibility with the old Hotkey component, accepts theme and size props for styling. New hotkeys should roll their own Hotkey component.
export function BasicHotkey(
  props: HotkeyProps & { theme?: Theme; size?: 'base' | 'lg' }
) {
  return (
    <div class="flex flex-row items-center font-mono">
      <div
        classList={{
          'font-mono inline-flex items-center': true,
          [hotkeyStyles[props.theme || 'base'].hotkey]: true,
          'text-[11px]/[8px] px-1 py-1 space-x-1':
            props.size === 'base' || !props.size,
          'text-[16px]/[24px] px-[9px] space-x-2': props.size === 'lg',
        }}
      >
        <Hotkey {...props} class="flex gap-[1ch]" />
      </div>
    </div>
  );
}
