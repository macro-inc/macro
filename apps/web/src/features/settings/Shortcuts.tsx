import { IS_MAC } from '@core/constant/isMac';
import { cn, Hotkey } from '@ui';
import { createMemo, createSignal, For, Index, type JSX, Show } from 'solid-js';
import { SettingsPage, SettingsSection, SettingsSurface } from './primitives';

interface ShortcutItem {
  description: JSX.Element;
  codes: string[];
  keys: string[];
}

interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
}

interface KeyDef {
  height: number;
  labelX: number;
  labelY: number;
  label: string;
  width: number;
  name: string;
  x: number;
  y: number;
}

const cmdOrCtrl = IS_MAC ? 'cmd' : 'ctrl';
const CmdOrCtrl = IS_MAC ? 'MetaLeft' : 'ControlLeft';

const KEYS: KeyDef[] = [
  // Row 1: Function keys
  {
    name: 'Escape',
    label: 'esc',
    x: 0.0763,
    y: 0.0763,
    width: 2.8473,
    height: 1.8473,
    labelX: 1.5,
    labelY: 1.0228,
  },
  {
    name: 'F1',
    label: 'F1',
    x: 3.0763,
    y: 0.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 4.0,
    labelY: 1.0228,
  },
  {
    name: 'F2',
    label: 'F2',
    x: 5.0763,
    y: 0.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 6.0,
    labelY: 1.0228,
  },
  {
    name: 'F3',
    label: 'F3',
    x: 7.0763,
    y: 0.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 8.0,
    labelY: 1.0228,
  },
  {
    name: 'F4',
    label: 'F4',
    x: 9.0763,
    y: 0.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 10.0,
    labelY: 1.0228,
  },
  {
    name: 'F5',
    label: 'F5',
    x: 11.0763,
    y: 0.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 12.0,
    labelY: 1.0228,
  },
  {
    name: 'F6',
    label: 'F6',
    x: 13.0763,
    y: 0.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 14.0,
    labelY: 1.0228,
  },
  {
    name: 'F7',
    label: 'F7',
    x: 15.0763,
    y: 0.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 16.0,
    labelY: 1.0228,
  },
  {
    name: 'F8',
    label: 'F8',
    x: 17.0763,
    y: 0.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 18.0,
    labelY: 1.0228,
  },
  {
    name: 'F9',
    label: 'F9',
    x: 19.0763,
    y: 0.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 20.0,
    labelY: 1.0228,
  },
  {
    name: 'F10',
    label: 'F10',
    x: 21.0763,
    y: 0.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 22.0,
    labelY: 1.0228,
  },
  {
    name: 'F11',
    label: 'F11',
    x: 23.0763,
    y: 0.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 24.0,
    labelY: 1.0228,
  },
  {
    name: 'F12',
    label: 'F12',
    x: 25.0763,
    y: 0.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 26.0,
    labelY: 1.0228,
  },
  {
    name: 'F13',
    label: 'F13',
    x: 27.0763,
    y: 0.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 28.0,
    labelY: 1.0228,
  },
  // Row 2: Number row
  {
    name: 'Backquote',
    label: '`',
    x: 0.0763,
    y: 2.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 1.0,
    labelY: 3.0228,
  },
  {
    name: 'Digit1',
    label: '1',
    x: 2.0763,
    y: 2.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 3.0,
    labelY: 3.0228,
  },
  {
    name: 'Digit2',
    label: '2',
    x: 4.0763,
    y: 2.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 5.0,
    labelY: 3.0228,
  },
  {
    name: 'Digit3',
    label: '3',
    x: 6.0763,
    y: 2.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 7.0,
    labelY: 3.0228,
  },
  {
    name: 'Digit4',
    label: '4',
    x: 8.0763,
    y: 2.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 9.0,
    labelY: 3.0228,
  },
  {
    name: 'Digit5',
    label: '5',
    x: 10.0763,
    y: 2.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 11.0,
    labelY: 3.0228,
  },
  {
    name: 'Digit6',
    label: '6',
    x: 12.0763,
    y: 2.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 13.0,
    labelY: 3.0228,
  },
  {
    name: 'Digit7',
    label: '7',
    x: 14.0763,
    y: 2.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 15.0,
    labelY: 3.0228,
  },
  {
    name: 'Digit8',
    label: '8',
    x: 16.0763,
    y: 2.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 17.0,
    labelY: 3.0228,
  },
  {
    name: 'Digit9',
    label: '9',
    x: 18.0763,
    y: 2.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 19.0,
    labelY: 3.0228,
  },
  {
    name: 'Digit0',
    label: '0',
    x: 20.0763,
    y: 2.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 21.0,
    labelY: 3.0228,
  },
  {
    name: 'Minus',
    label: '-',
    x: 22.0763,
    y: 2.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 23.0,
    labelY: 3.0228,
  },
  {
    name: 'Equal',
    label: '=',
    x: 24.0763,
    y: 2.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 25.0,
    labelY: 3.0228,
  },
  {
    name: 'Backspace',
    label: 'del',
    x: 26.0763,
    y: 2.0763,
    width: 2.8473,
    height: 1.8473,
    labelX: 27.5,
    labelY: 3.0228,
  },
  // Row 3: QWERTY row
  {
    name: 'Tab',
    label: 'tab',
    x: 0.0763,
    y: 4.0763,
    width: 2.8473,
    height: 1.8473,
    labelX: 1.5,
    labelY: 5.0228,
  },
  {
    name: 'KeyQ',
    label: 'Q',
    x: 3.0763,
    y: 4.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 4.0,
    labelY: 5.0228,
  },
  {
    name: 'KeyW',
    label: 'W',
    x: 5.0763,
    y: 4.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 6.0,
    labelY: 5.0228,
  },
  {
    name: 'KeyE',
    label: 'E',
    x: 7.0763,
    y: 4.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 8.0,
    labelY: 5.0228,
  },
  {
    name: 'KeyR',
    label: 'R',
    x: 9.0763,
    y: 4.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 10.0,
    labelY: 5.0228,
  },
  {
    name: 'KeyT',
    label: 'T',
    x: 11.0763,
    y: 4.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 12.0,
    labelY: 5.0228,
  },
  {
    name: 'KeyY',
    label: 'Y',
    x: 13.0763,
    y: 4.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 14.0,
    labelY: 5.0228,
  },
  {
    name: 'KeyU',
    label: 'U',
    x: 15.0763,
    y: 4.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 16.0,
    labelY: 5.0228,
  },
  {
    name: 'KeyI',
    label: 'I',
    x: 17.0763,
    y: 4.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 18.0,
    labelY: 5.0228,
  },
  {
    name: 'KeyO',
    label: 'O',
    x: 19.0763,
    y: 4.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 20.0,
    labelY: 5.0228,
  },
  {
    name: 'KeyP',
    label: 'P',
    x: 21.0763,
    y: 4.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 22.0,
    labelY: 5.0228,
  },
  {
    name: 'BracketLeft',
    label: '[',
    x: 23.0763,
    y: 4.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 24.0,
    labelY: 5.0228,
  },
  {
    name: 'BracketRight',
    label: ']',
    x: 25.0763,
    y: 4.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 26.0,
    labelY: 5.0228,
  },
  {
    name: 'Backslash',
    label: '\\',
    x: 27.0763,
    y: 4.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 28.0,
    labelY: 5.0228,
  },
  // Row 4: Home row
  {
    name: 'CapsLock',
    label: 'caps',
    x: 0.0763,
    y: 6.0763,
    width: 3.3473,
    height: 1.8473,
    labelX: 1.75,
    labelY: 7.0228,
  },
  {
    name: 'KeyA',
    label: 'A',
    x: 3.5763,
    y: 6.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 4.5,
    labelY: 7.0228,
  },
  {
    name: 'KeyS',
    label: 'S',
    x: 5.5763,
    y: 6.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 6.5,
    labelY: 7.0228,
  },
  {
    name: 'KeyD',
    label: 'D',
    x: 7.5763,
    y: 6.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 8.5,
    labelY: 7.0228,
  },
  {
    name: 'KeyF',
    label: 'F',
    x: 9.5763,
    y: 6.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 10.5,
    labelY: 7.0228,
  },
  {
    name: 'KeyG',
    label: 'G',
    x: 11.5763,
    y: 6.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 12.5,
    labelY: 7.0228,
  },
  {
    name: 'KeyH',
    label: 'H',
    x: 13.5763,
    y: 6.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 14.5,
    labelY: 7.0228,
  },
  {
    name: 'KeyJ',
    label: 'J',
    x: 15.5763,
    y: 6.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 16.5,
    labelY: 7.0228,
  },
  {
    name: 'KeyK',
    label: 'K',
    x: 17.5763,
    y: 6.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 18.5,
    labelY: 7.0228,
  },
  {
    name: 'KeyL',
    label: 'L',
    x: 19.5763,
    y: 6.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 20.5,
    labelY: 7.0228,
  },
  {
    name: 'Semicolon',
    label: ';',
    x: 21.5763,
    y: 6.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 22.5,
    labelY: 7.0228,
  },
  {
    name: 'Quote',
    label: "'",
    x: 23.5763,
    y: 6.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 24.5,
    labelY: 7.0228,
  },
  {
    name: 'Enter',
    label: 'enter',
    x: 25.5763,
    y: 6.0763,
    width: 3.3473,
    height: 1.8473,
    labelX: 27.25,
    labelY: 7.0228,
  },
  // Row 5: Bottom letter row
  {
    name: 'ShiftLeft',
    label: 'shift',
    x: 0.0763,
    y: 8.0763,
    width: 4.3473,
    height: 1.8473,
    labelX: 2.25,
    labelY: 9.0228,
  },
  {
    name: 'KeyZ',
    label: 'Z',
    x: 4.5763,
    y: 8.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 5.5,
    labelY: 9.0228,
  },
  {
    name: 'KeyX',
    label: 'X',
    x: 6.5763,
    y: 8.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 7.5,
    labelY: 9.0228,
  },
  {
    name: 'KeyC',
    label: 'C',
    x: 8.5763,
    y: 8.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 9.5,
    labelY: 9.0228,
  },
  {
    name: 'KeyV',
    label: 'V',
    x: 10.5763,
    y: 8.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 11.5,
    labelY: 9.0228,
  },
  {
    name: 'KeyB',
    label: 'B',
    x: 12.5763,
    y: 8.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 13.5,
    labelY: 9.0228,
  },
  {
    name: 'KeyN',
    label: 'N',
    x: 14.5763,
    y: 8.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 15.5,
    labelY: 9.0228,
  },
  {
    name: 'KeyM',
    label: 'M',
    x: 16.5763,
    y: 8.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 17.5,
    labelY: 9.0228,
  },
  {
    name: 'Comma',
    label: ',',
    x: 18.5763,
    y: 8.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 19.5,
    labelY: 9.0228,
  },
  {
    name: 'Period',
    label: '.',
    x: 20.5763,
    y: 8.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 21.5,
    labelY: 9.0228,
  },
  {
    name: 'Slash',
    label: '/',
    x: 22.5763,
    y: 8.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 23.5,
    labelY: 9.0228,
  },
  {
    name: 'ShiftRight',
    label: 'shift',
    x: 24.5763,
    y: 8.0763,
    width: 4.3473,
    height: 1.8473,
    labelX: 26.75,
    labelY: 9.0228,
  },
  // Row 6: Bottom row
  {
    name: 'Fn',
    label: 'fn',
    x: 0.0763,
    y: 10.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 1.0,
    labelY: 11.0228,
  },
  {
    name: 'ControlLeft',
    label: 'ctrl',
    x: 2.0763,
    y: 10.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 3.0,
    labelY: 11.0228,
  },
  {
    name: 'AltLeft',
    label: 'opt',
    x: 4.0763,
    y: 10.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 5.0,
    labelY: 11.0228,
  },
  {
    name: 'MetaLeft',
    label: 'cmd',
    x: 6.0763,
    y: 10.0763,
    width: 2.3473,
    height: 1.8473,
    labelX: 7.25,
    labelY: 11.0228,
  },
  {
    name: 'Space',
    label: 'space',
    x: 8.5763,
    y: 10.0763,
    width: 9.8473,
    height: 1.8473,
    labelX: 13.5,
    labelY: 11.0228,
  },
  {
    name: 'MetaRight',
    label: 'cmd',
    x: 18.5763,
    y: 10.0763,
    width: 2.3473,
    height: 1.8473,
    labelX: 19.75,
    labelY: 11.0228,
  },
  {
    name: 'AltRight',
    label: 'opt',
    x: 21.0763,
    y: 10.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 22.0,
    labelY: 11.0228,
  },
  {
    name: 'ArrowLeft',
    label: '◂',
    x: 23.0763,
    y: 10.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 24.0,
    labelY: 11.0228,
  },
  {
    name: 'ArrowUp',
    label: '▴',
    x: 25.0763,
    y: 10.0763,
    width: 1.8473,
    height: 0.8473,
    labelX: 26.0,
    labelY: 10.5,
  },
  {
    name: 'ArrowDown',
    label: '▾',
    x: 25.0763,
    y: 11.0763,
    width: 1.8473,
    height: 0.8473,
    labelX: 26.0,
    labelY: 11.5,
  },
  {
    name: 'ArrowRight',
    label: '▸',
    x: 27.0763,
    y: 10.0763,
    width: 1.8473,
    height: 1.8473,
    labelX: 28.0,
    labelY: 11.0228,
  },
];

function KeyRect(props: { def: KeyDef; active: boolean }) {
  const stroke = () =>
    props.active ? 'var(--color-accent)' : 'var(--color-edge)';
  const fill = () =>
    props.active
      ? 'oklch(from var(--color-accent) l c h / 0.1)'
      : 'oklch(from var(--color-surface-2) l c h / 0.1)';

  return (
    <>
      <rect
        style={{ fill: fill(), stroke: stroke() }}
        height={props.def.height}
        width={props.def.width}
        x={props.def.x}
        y={props.def.y}
        ry="0.2"
      />
      <text
        style={{
          'font-family': 'var(--font-mono)',
          'dominant-baseline': 'central',
          'text-anchor': 'middle',
          'font-size': '0.4',
          stroke: 'none',
          fill: stroke(),
        }}
        x={props.def.labelX}
        y={props.def.labelY}
      >
        {props.def.label}
      </text>
    </>
  );
}

function Keyboard(props: { keys?: string[] }): JSX.Element {
  const active = createMemo(() => new Set(props.keys ?? []));

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      style={{
        'stroke-linejoin': 'round',
        'box-sizing': 'border-box',
        'stroke-linecap': 'round',
        'stroke-width': '0.0572',
        display: 'block',
        width: '100%',
        fill: 'none',
      }}
      viewBox="0 0 29 12"
    >
      <For each={KEYS}>
        {(key) => <KeyRect def={key} active={active().has(key.name)} />}
      </For>
    </svg>
  );
}

const shortcutSections: ShortcutSection[] = [
  {
    title: 'Core',
    items: [
      {
        keys: [`${cmdOrCtrl}+k`],
        codes: [CmdOrCtrl, 'KeyK'],
        description: 'Open the command menu',
      },
      {
        keys: [`${cmdOrCtrl}+f`],
        codes: [CmdOrCtrl, 'KeyF'],
        description: 'Search in current view',
      },
      { keys: ['c'], codes: ['KeyC'], description: 'Open the create menu' },
      {
        keys: [`${cmdOrCtrl}+;`],
        codes: [CmdOrCtrl, 'Semicolon'],
        description: 'Open settings panel',
      },
      { keys: ['/'], codes: ['Slash'], description: 'Go to search view' },
      {
        keys: [`${cmdOrCtrl}+j`],
        codes: [CmdOrCtrl, 'KeyJ'],
        description: 'Focus AI chat',
      },
      { keys: ['g'], codes: ['KeyG'], description: 'Go to a view' },
    ],
  },
  {
    title: 'Splits',
    items: [
      {
        keys: ['opt+['],
        codes: ['AltLeft', 'BracketLeft'],
        description: 'Go back in current split',
      },
      {
        keys: ['opt+]'],
        codes: ['AltLeft', 'BracketRight'],
        description: 'Go forward in current split',
      },
      {
        keys: ['shift+arrowleft'],
        codes: ['ShiftLeft', 'ArrowLeft'],
        description: 'Focus split to the left',
      },
      {
        keys: ['shift+arrowright'],
        codes: ['ShiftLeft', 'ArrowRight'],
        description: 'Focus split to the right',
      },
      {
        keys: ['cmd+escape'],
        codes: ['MetaLeft', 'Escape'],
        description: 'Back to list / close split',
      },
      {
        keys: ['shift+escape'],
        codes: ['ShiftLeft', 'Escape'],
        description: 'Spotlight split',
      },
      { keys: ['\\'], codes: ['Backslash'], description: 'Create a split' },
    ],
  },
  {
    title: 'Unified List',
    items: [
      {
        keys: ['enter'],
        codes: ['Enter'],
        description: 'Open item in current split',
      },
      {
        keys: ['shift+enter'],
        codes: ['ShiftLeft', 'Enter'],
        description: 'Open item in a new split',
      },
      {
        keys: ['opt+enter'],
        codes: ['AltLeft', 'Enter'],
        description: 'Open item in place of the preview',
      },
      { keys: ['arrowup'], codes: ['ArrowUp'], description: 'Move up' },
      { keys: ['arrowdown'], codes: ['ArrowDown'], description: 'Move down' },
      {
        keys: ['shift+arrowup'],
        codes: ['ShiftLeft', 'ArrowUp'],
        description: 'Select up',
      },
      {
        keys: ['shift+arrowdown'],
        codes: ['ShiftLeft', 'ArrowDown'],
        description: 'Select down',
      },
      {
        keys: ['arrowleft'],
        codes: ['ArrowLeft'],
        description: 'Collapse item',
      },
      {
        keys: ['arrowright'],
        codes: ['ArrowRight'],
        description: 'Expand item',
      },
      { keys: ['space'], codes: ['Space'], description: 'Preview item' },
      { keys: ['f'], codes: ['KeyF'], description: 'Open filter menu' },
      { keys: ['x'], codes: ['KeyX'], description: 'Select items' },
      { keys: ['e'], codes: ['KeyE'], description: 'Mark done' },
      { keys: ['u'], codes: ['KeyU'], description: 'Mark unread' },
      {
        keys: ['shift+u'],
        codes: ['ShiftLeft', 'KeyU'],
        description: 'Mark read',
      },
      {
        keys: ['#'],
        codes: ['ShiftLeft', 'Digit3'],
        description: 'Delete email',
      },
    ],
  },
];

const [hoveredCodes, setHoveredCodes] = createSignal<string[]>([]);

function Kbd(props: { shortcut: string; class?: string }) {
  return (
    <span
      class={cn(
        'inline-flex items-center rounded-md px-2 py-1 text-sm uppercase text-ink/60',
        props.class
      )}
    >
      <Hotkey shortcut={props.shortcut} class="flex gap-0.5" lowercase />
    </span>
  );
}

function ShortcutRow(props: { item: ShortcutItem; spacer?: string }) {
  return (
    <div
      class="group flex min-h-13 items-center justify-between gap-6 py-3 hover:bg-ink/3"
      onMouseEnter={() => setHoveredCodes(props.item.codes)}
      onMouseLeave={() => setHoveredCodes([])}
    >
      <span class="min-w-0 text-base text-ink">{props.item.description}</span>
      <div class="flex shrink-0 flex-wrap justify-end items-center gap-2 uppercase">
        <Index each={props.item.keys}>
          {(key, index) => (
            <>
              <Show when={index > 0 && props.spacer}>
                <span class="text-xs lowercase text-ink/40">
                  {props.spacer}
                </span>
              </Show>
              <Kbd shortcut={key()} />
            </>
          )}
        </Index>
      </div>
    </div>
  );
}

function ShortcutSectionComponent(props: { section: ShortcutSection }) {
  return (
    <SettingsSection title={props.section.title}>
      <div class="divide-y divide-ink/5">
        <For each={props.section.items}>
          {(item) => <ShortcutRow item={item} spacer="or" />}
        </For>
      </div>
    </SettingsSection>
  );
}

export function Shortcuts() {
  return (
    <SettingsPage
      title="Keyboard shortcuts"
      description="Quick ways to navigate, search, and work in Macro."
    >
      <SettingsSurface class="px-5 py-4">
        <details>
          <summary class="text-sm text-ink/60">Keyboard preview</summary>
          <div class="pt-4">
            <Keyboard keys={hoveredCodes()} />
          </div>
        </details>
      </SettingsSurface>
      <For each={shortcutSections}>
        {(section) => <ShortcutSectionComponent section={section} />}
      </For>
    </SettingsPage>
  );
}
