import { createMemo, For, type JSX, Show, splitProps } from 'solid-js';
import { getPrettyHotkeyStringByToken } from '@core/hotkey/utils';
import type { HotkeyToken } from '@core/hotkey/tokens';
import type { Theme } from 'core/component/Themes';
import { IS_MAC } from '@core/constant/isMac';

export const modifierMap = {
  shift: IS_MAC ? '⇧' : 'Shift',
  ctrl: IS_MAC ? '⌃' : 'Ctrl',
  meta: IS_MAC ? '⌘' : 'Ctrl',
  cmd: IS_MAC ? '⌘' : 'Ctrl',
  opt: IS_MAC ? '⌥' : 'Alt',
} as const;

const symbolMap = {
  ARROWRIGHT: '→',
  ARROWLEFT: '←',
  ARROWDOWN: '↓',
  BACKSPACE: '⌫',
  SPACE: 'Space',
  ESCAPE: 'ESC',
  ARROWUP: '↑',
  DELETE: '⌦',
  ENTER: '↵',
};

export const hotkeyStyles: Record<Theme, { label: string; hotkey: string }> = {

  extraMuted: {
    hotkey: 'bg-dialog border border-ink-extra-muted text-ink-extra-muted',
    label: 'bg-ink-extra-muted border border-ink-extra-muted text-dialog',
  },
  disabled: {
    hotkey: 'bg-dialog border border-ink-disabled text-ink-disabled',
    label: 'bg-ink-disabled border border-ink-disabled text-dialog',
  },
  muted: {
    hotkey: 'bg-dialog border border-ink-muted text-ink-muted',
    label: 'bg-ink-muted border border-ink-muted text-dialog',
  },
  accent: {
    hotkey: 'bg-accent/10 border border-accent/30 text-accent',
    label: 'bg-accent border border-accent/30 text-dialog',
  },
  current: {
    hotkey: 'bg-dialog border border-current text-current',
    label: 'bg-current border border-current text-dialog',
  },
  accentFill: {
    hotkey: 'bg-dialog border border-accent text-accent',
    label: 'bg-accent border border-accent text-dialog',
  },
  reverse: {
    hotkey: 'bg-ink border border-dialog text-dialog',
    label: 'bg-dialog border border dialog text-ink',
  },

  base: {
    hotkey: 'bg-dialog border border-ink text-ink',
    label: 'bg-ink border border-ink text-dialog',
  },
  accentOpaque: {
    label: '',
    hotkey: '',
  },
  contrast: {
    label: '',
    hotkey: '',
  },
  selected: {
    label: '',
    hotkey: '',
  },
  clear: {
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

};

const getSymbol = (key: string) => key.toUpperCase() in symbolMap ? symbolMap[key.toUpperCase() as keyof typeof symbolMap] : key;

const modifierKeys = Object.keys(modifierMap);

function breakApartHotkeyString(hotkey: string) {
  const parts = hotkey.split('+');
  if (parts.length === 0) { return { key: '', modifiers: [] }; }
  const key = parts
    .filter((part) => !modifierKeys.includes(part))
    .map(getSymbol);
  const modifiers = parts.filter((part) => modifierKeys.includes(part));
  return { key, modifiers };
}

interface HotkeyProps extends JSX.HTMLAttributes<HTMLDivElement> {
  lowercase?: boolean;
  token?: HotkeyToken;
  showPlus?: boolean;
  shortcut?: string;
}

/**
 * A component that displays a hotkey for either: 1) a given hotkey token, as registered in the hotkey registry or 2) a shortcut string (e.g. 'cmd+c').
 * @param props.token - The hotkey registry token to display the hotkey for.
 * @param props.shortcut - The shortcut string to display the hotkey for.
 * @example
 * <Hotkey token="canvas.cut" />
 */
export function Hotkey(props: HotkeyProps){
  const [local, rest] = splitProps(props, [
    'lowercase',
    'children',
    'shortcut',
    'showPlus',
    'token',
  ]);
  const tokenShortcut = createMemo(() => { return local.token ? getPrettyHotkeyStringByToken(local.token) : undefined });

  const hotkey = createMemo(() => {
    // fallback for when we specify a shortcut directly instead of a hotkey token
    if (local.shortcut && !tokenShortcut()) { return breakApartHotkeyString(local.shortcut); }
    if (!tokenShortcut()) { return { key: '', modifiers: [] }; }
    return breakApartHotkeyString(tokenShortcut() ?? '');
  });

  function normalizedKey(){
    const key = hotkey().key;
    return props.lowercase
      ? typeof key === 'string'
        ? key.toLowerCase()
        : key.map((k) => k.toLowerCase())
      : typeof key === 'string'
        ? key.toUpperCase()
        : key.map((k) => k.toUpperCase());
  };

  // Don't render anything if there are no modifiers and no key
  function hasContent(){
    const h = hotkey();
    const key = normalizedKey();
    return (
      h.modifiers.length > 0 ||
      (key && (typeof key === 'string' ? key.length > 0 : key.length > 0))
    );
  };

  return (
    <Show when={hasContent()}>
      <div {...rest}>
        <For each={hotkey().modifiers}>
          {(mod) => (
            <>
              <span>
                {modifierMap[mod as keyof typeof modifierMap] || mod}
              </span>

              <Show when={local.showPlus}>
                <span> + </span>
              </Show>
            </>
          )}
        </For>
        <Show when={normalizedKey()}>
          <span>{normalizedKey()}</span>
        </Show>
      </div>
    </Show>
  );
};
