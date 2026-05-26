import { createMemo, For, type JSX, Show, splitProps } from 'solid-js';
import { getPrettyHotkeyStringByToken } from '@core/hotkey/utils';
import type { HotkeyToken } from '@core/hotkey/tokens';
import type { Theme } from 'core/component/Themes';
import { IS_MAC } from '@core/constant/isMac';
import { cn } from '@ui';

const modifierMap = {
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

const hotkeyStyles: Record<Theme, { label: string; hotkey: string }> = {

  extraMuted: {
    hotkey: 'bg-surface border border-ink-extra-muted text-ink-extra-muted',
    label: 'bg-ink-extra-muted border border-ink-extra-muted text-surface',
  },
  disabled: {
    hotkey: 'bg-surface border border-ink-disabled text-ink-disabled',
    label: 'bg-ink-disabled border border-ink-disabled text-surface',
  },
  muted: {
    hotkey: 'bg-surface border border-ink-muted text-ink-muted',
    label: 'bg-ink-muted border border-ink-muted text-surface',
  },
  subtle: {
    hotkey: 'bg-transparent border border-edge text-ink-extra-muted',
    label: 'bg-ink-extra-muted border border-edge text-surface',
  },
  accent: {
    hotkey: 'bg-accent/10 border border-accent/30 text-accent',
    label: 'bg-accent border border-accent/30 text-surface',
  },
  current: {
    hotkey: 'border border-current/30 text-current',
    label: 'bg-current border border-current text-surface',
  },
  accentFill: {
    hotkey: 'bg-surface border border-accent text-accent',
    label: 'bg-accent border border-accent text-surface',
  },
  reverse: {
    hotkey: 'bg-ink border border-surface text-surface',
    label: 'bg-surface border border dialog text-ink',
  },

  base: {
    hotkey: 'bg-surface border border-ink text-ink',
    label: 'bg-ink border border-ink text-surface',
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
  shortcut?: string;
  showPlus?: boolean;
  theme?: Theme;
}

/**
 * A component that displays a hotkey for a given hotkey token, as registered in the hotkey registry.
 * @param props.token - The hotkey registry token to display the hotkey for.
 * @example
 * <Hotkey token={TOKENS.canvas.cut} />
 */
/**
 * Returns the hotkey as a plain string, handling the same props as Hotkey.
 * @param props.token - The hotkey registry token to get the string for.
 * @param props.shortcut - Or a direct shortcut string.
 * @param props.lowercase - Whether to lowercase the key.
 * @param props.showPlus - Whether to include '+' between parts.
 * @example
 * getNormalizedKeyString({ token: TOKENS.canvas.cut }) // "⌘X"
 * getNormalizedKeyString({ shortcut: 'meta+shift+k', showPlus: true }) // "⌘ + ⇧ + K"
 */
export function getNormalizedKeyString(props: Pick<HotkeyProps, 'token' | 'shortcut' | 'lowercase' | 'showPlus'>): string {
  const resolvedShortcut = props.token ? getPrettyHotkeyStringByToken(props.token) : props.shortcut;

  if (!resolvedShortcut) return '';

  const hotkey = breakApartHotkeyString(resolvedShortcut);

  const normalizedKey = props.lowercase
    ? typeof hotkey.key === 'string'
      ? hotkey.key.toLowerCase()
      : hotkey.key.map((k) => k.toLowerCase())
    : typeof hotkey.key === 'string'
      ? hotkey.key.toUpperCase()
      : hotkey.key.map((k) => k.toUpperCase());

  const modifierStrings = hotkey.modifiers.map(
    (mod) => modifierMap[mod as keyof typeof modifierMap] || mod
  );

  const keyStrings = typeof normalizedKey === 'string'
    ? (normalizedKey ? [normalizedKey] : [])
    : normalizedKey;

  const separator = props.showPlus ? ' + ' : '';

  return [...modifierStrings, ...keyStrings].join(separator);
}

export function Hotkey(props: HotkeyProps){
  const [local, rest] = splitProps(props, [
    'lowercase',
    'children',
    'shortcut',
    'showPlus',
    'token',
    'theme',
    'class',
  ]);

  const resolvedShortcut = createMemo(() => {
    if (local.token) return getPrettyHotkeyStringByToken(local.token);
    return local.shortcut;
  });

  const hotkey = createMemo(() => {
    const s = resolvedShortcut();
    if (!s) { return { key: '', modifiers: [] }; }
    return breakApartHotkeyString(s);
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
      <div
        {...rest}
        class={cn(
          'inline-flex items-center gap-1',
          local.theme && 'rounded-sm px-1.5 py-px text-xxs',
          local.theme && hotkeyStyles[local.theme]?.hotkey,
          local.class
        )}
      >
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
