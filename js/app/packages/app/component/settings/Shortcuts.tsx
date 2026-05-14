import { createSignal, For, Index, createMemo, type JSX } from 'solid-js';
import { IS_MAC } from '@core/constant/isMac';
import { Hotkey } from '@ui';
import { Panel } from '@ui';
import { cn } from '@ui';

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
  { name: 'Escape',       label: 'esc',   x:  0.0763, y:  0.0763, width: 2.8473, height: 1.8473, labelX:  1.50, labelY:  1.0228 },
  { name: 'F1',           label: 'F1',    x:  3.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX:  4.00, labelY:  1.0228 },
  { name: 'F2',           label: 'F2',    x:  5.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX:  6.00, labelY:  1.0228 },
  { name: 'F3',           label: 'F3',    x:  7.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX:  8.00, labelY:  1.0228 },
  { name: 'F4',           label: 'F4',    x:  9.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 10.00, labelY:  1.0228 },
  { name: 'F5',           label: 'F5',    x: 11.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 12.00, labelY:  1.0228 },
  { name: 'F6',           label: 'F6',    x: 13.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 14.00, labelY:  1.0228 },
  { name: 'F7',           label: 'F7',    x: 15.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 16.00, labelY:  1.0228 },
  { name: 'F8',           label: 'F8',    x: 17.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 18.00, labelY:  1.0228 },
  { name: 'F9',           label: 'F9',    x: 19.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 20.00, labelY:  1.0228 },
  { name: 'F10',          label: 'F10',   x: 21.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 22.00, labelY:  1.0228 },
  { name: 'F11',          label: 'F11',   x: 23.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 24.00, labelY:  1.0228 },
  { name: 'F12',          label: 'F12',   x: 25.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 26.00, labelY:  1.0228 },
  { name: 'F13',          label: 'F13',   x: 27.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 28.00, labelY:  1.0228 },
  // Row 2: Number row
  { name: 'Backquote',    label: '`',     x:  0.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX:  1.00, labelY:  3.0228 },
  { name: 'Digit1',       label: '1',     x:  2.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX:  3.00, labelY:  3.0228 },
  { name: 'Digit2',       label: '2',     x:  4.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX:  5.00, labelY:  3.0228 },
  { name: 'Digit3',       label: '3',     x:  6.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX:  7.00, labelY:  3.0228 },
  { name: 'Digit4',       label: '4',     x:  8.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX:  9.00, labelY:  3.0228 },
  { name: 'Digit5',       label: '5',     x: 10.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 11.00, labelY:  3.0228 },
  { name: 'Digit6',       label: '6',     x: 12.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 13.00, labelY:  3.0228 },
  { name: 'Digit7',       label: '7',     x: 14.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 15.00, labelY:  3.0228 },
  { name: 'Digit8',       label: '8',     x: 16.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 17.00, labelY:  3.0228 },
  { name: 'Digit9',       label: '9',     x: 18.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 19.00, labelY:  3.0228 },
  { name: 'Digit0',       label: '0',     x: 20.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 21.00, labelY:  3.0228 },
  { name: 'Minus',        label: '-',     x: 22.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 23.00, labelY:  3.0228 },
  { name: 'Equal',        label: '=',     x: 24.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 25.00, labelY:  3.0228 },
  { name: 'Backspace',    label: 'del',   x: 26.0763, y:  2.0763, width: 2.8473, height: 1.8473, labelX: 27.50, labelY:  3.0228 },
  // Row 3: QWERTY row
  { name: 'Tab',          label: 'tab',   x:  0.0763, y:  4.0763, width: 2.8473, height: 1.8473, labelX:  1.50, labelY:  5.0228 },
  { name: 'KeyQ',         label: 'Q',     x:  3.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX:  4.00, labelY:  5.0228 },
  { name: 'KeyW',         label: 'W',     x:  5.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX:  6.00, labelY:  5.0228 },
  { name: 'KeyE',         label: 'E',     x:  7.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX:  8.00, labelY:  5.0228 },
  { name: 'KeyR',         label: 'R',     x:  9.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 10.00, labelY:  5.0228 },
  { name: 'KeyT',         label: 'T',     x: 11.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 12.00, labelY:  5.0228 },
  { name: 'KeyY',         label: 'Y',     x: 13.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 14.00, labelY:  5.0228 },
  { name: 'KeyU',         label: 'U',     x: 15.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 16.00, labelY:  5.0228 },
  { name: 'KeyI',         label: 'I',     x: 17.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 18.00, labelY:  5.0228 },
  { name: 'KeyO',         label: 'O',     x: 19.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 20.00, labelY:  5.0228 },
  { name: 'KeyP',         label: 'P',     x: 21.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 22.00, labelY:  5.0228 },
  { name: 'BracketLeft',  label: '[',     x: 23.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 24.00, labelY:  5.0228 },
  { name: 'BracketRight', label: ']',     x: 25.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 26.00, labelY:  5.0228 },
  { name: 'Backslash',    label: '\\',    x: 27.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 28.00, labelY:  5.0228 },
  // Row 4: Home row
  { name: 'CapsLock',     label: 'caps',  x:  0.0763, y:  6.0763, width: 3.3473, height: 1.8473, labelX:  1.75, labelY:  7.0228 },
  { name: 'KeyA',         label: 'A',     x:  3.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX:  4.50, labelY:  7.0228 },
  { name: 'KeyS',         label: 'S',     x:  5.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX:  6.50, labelY:  7.0228 },
  { name: 'KeyD',         label: 'D',     x:  7.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX:  8.50, labelY:  7.0228 },
  { name: 'KeyF',         label: 'F',     x:  9.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 10.50, labelY:  7.0228 },
  { name: 'KeyG',         label: 'G',     x: 11.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 12.50, labelY:  7.0228 },
  { name: 'KeyH',         label: 'H',     x: 13.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 14.50, labelY:  7.0228 },
  { name: 'KeyJ',         label: 'J',     x: 15.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 16.50, labelY:  7.0228 },
  { name: 'KeyK',         label: 'K',     x: 17.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 18.50, labelY:  7.0228 },
  { name: 'KeyL',         label: 'L',     x: 19.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 20.50, labelY:  7.0228 },
  { name: 'Semicolon',    label: ';',     x: 21.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 22.50, labelY:  7.0228 },
  { name: 'Quote',        label: "'",     x: 23.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 24.50, labelY:  7.0228 },
  { name: 'Enter',        label: 'enter', x: 25.5763, y:  6.0763, width: 3.3473, height: 1.8473, labelX: 27.25, labelY:  7.0228 },
  // Row 5: Bottom letter row
  { name: 'ShiftLeft',    label: 'shift', x:  0.0763, y:  8.0763, width: 4.3473, height: 1.8473, labelX:  2.25, labelY:  9.0228 },
  { name: 'KeyZ',         label: 'Z',     x:  4.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX:  5.50, labelY:  9.0228 },
  { name: 'KeyX',         label: 'X',     x:  6.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX:  7.50, labelY:  9.0228 },
  { name: 'KeyC',         label: 'C',     x:  8.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX:  9.50, labelY:  9.0228 },
  { name: 'KeyV',         label: 'V',     x: 10.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX: 11.50, labelY:  9.0228 },
  { name: 'KeyB',         label: 'B',     x: 12.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX: 13.50, labelY:  9.0228 },
  { name: 'KeyN',         label: 'N',     x: 14.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX: 15.50, labelY:  9.0228 },
  { name: 'KeyM',         label: 'M',     x: 16.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX: 17.50, labelY:  9.0228 },
  { name: 'Comma',        label: ',',     x: 18.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX: 19.50, labelY:  9.0228 },
  { name: 'Period',       label: '.',     x: 20.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX: 21.50, labelY:  9.0228 },
  { name: 'Slash',        label: '/',     x: 22.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX: 23.50, labelY:  9.0228 },
  { name: 'ShiftRight',   label: 'shift', x: 24.5763, y:  8.0763, width: 4.3473, height: 1.8473, labelX: 26.75, labelY:  9.0228 },
  // Row 6: Bottom row
  { name: 'Fn',           label: 'fn',    x:  0.0763, y: 10.0763, width: 1.8473, height: 1.8473, labelX:  1.00, labelY: 11.0228 },
  { name: 'ControlLeft',  label: 'ctrl',  x:  2.0763, y: 10.0763, width: 1.8473, height: 1.8473, labelX:  3.00, labelY: 11.0228 },
  { name: 'AltLeft',      label: 'opt',   x:  4.0763, y: 10.0763, width: 1.8473, height: 1.8473, labelX:  5.00, labelY: 11.0228 },
  { name: 'MetaLeft',     label: 'cmd',   x:  6.0763, y: 10.0763, width: 2.3473, height: 1.8473, labelX:  7.25, labelY: 11.0228 },
  { name: 'Space',        label: 'space', x:  8.5763, y: 10.0763, width: 9.8473, height: 1.8473, labelX: 13.50, labelY: 11.0228 },
  { name: 'MetaRight',    label: 'cmd',   x: 18.5763, y: 10.0763, width: 2.3473, height: 1.8473, labelX: 19.75, labelY: 11.0228 },
  { name: 'AltRight',     label: 'opt',   x: 21.0763, y: 10.0763, width: 1.8473, height: 1.8473, labelX: 22.00, labelY: 11.0228 },
  { name: 'ArrowLeft',    label: '◂',     x: 23.0763, y: 10.0763, width: 1.8473, height: 1.8473, labelX: 24.00, labelY: 11.0228 },
  { name: 'ArrowUp',      label: '▴',     x: 25.0763, y: 10.0763, width: 1.8473, height: 0.8473, labelX: 26.00, labelY: 10.5000 },
  { name: 'ArrowDown',    label: '▾',     x: 25.0763, y: 11.0763, width: 1.8473, height: 0.8473, labelX: 26.00, labelY: 11.5000 },
  { name: 'ArrowRight',   label: '▸',     x: 27.0763, y: 10.0763, width: 1.8473, height: 1.8473, labelX: 28.00, labelY: 11.0228 },
];

function KeyRect(props: { def: KeyDef; active: boolean }) {
  const stroke = () => (props.active ? 'var(--a0)' : 'var(--b4)');
  const fill = () =>
    props.active ? 'oklch(from var(--a0) l c h / 0.1)' : 'oklch(from var(--b2) l c h / 0.1)';

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
          'stroke': 'none',
          'fill': stroke(),
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
        'display': 'block',
        'width': '100%',
        'fill': 'none',
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
      { keys: [`${cmdOrCtrl}+k`], codes: [CmdOrCtrl, 'KeyK']        , description: 'Open the command menu'  },
      { keys: [`${cmdOrCtrl}+f`], codes: [CmdOrCtrl, 'KeyF']        , description: 'Search in current view' },
      { keys: ['c']             , codes: ['KeyC']                   , description: 'Open the create menu'   },
      { keys: [`${cmdOrCtrl}+;`], codes: [CmdOrCtrl, 'Semicolon']   , description: 'Open settings panel'    },
      { keys: ['/']             , codes: ['Slash']                  , description: 'Go to search view'      },
      { keys: [`${cmdOrCtrl}+j`], codes: [CmdOrCtrl, 'KeyJ']        , description: 'Focus AI chat'          },
      { keys: ['g']             , codes: ['KeyG']                   , description: 'Go to a view'           },
    ],
  },
  {
    title: 'Splits',
    items: [
      { keys: ['opt+]']           , codes: ['AltLeft', 'BracketRight']    , description: 'Go forward in current split' },
      { keys: ['cmd+escape']      , codes: ['MetaLeft', 'Escape']         , description: 'Go home / close split'       },
      { keys: ['opt+[']           , codes: ['AltLeft', 'BracketLeft']     , description: 'Go back in current split'    },
      { keys: ['shift+arrowright'], codes: ['ShiftLeft', 'ArrowRight']    , description: 'Focus split to the right'    },
      { keys: ['shift+arrowleft'] , codes: ['ShiftLeft', 'ArrowLeft']     , description: 'Focus split to the left'     },
      { keys: ['shift+escape']    , codes: ['ShiftLeft', 'Escape']        , description: 'Spotlight split'             },
      { keys: ['\\']              , codes: ['Backslash']                  , description: 'Create a split'              },
    ],
  },
  {
    title: 'Unified List',
    items: [
      { keys: ['enter']          , codes: ['Enter']                   , description: 'Open item in current split' },
      { keys: ['shift+enter']    , codes: ['ShiftLeft', 'Enter']      , description: 'Open item in a new split'   },
      { keys: ['space']          , codes: ['Space']                   , description: 'Preview item'               },
      { keys: ['shift+arrowdown'], codes: ['ShiftLeft', 'ArrowDown']  , description: 'Select down'                },
      { keys: ['f']              , codes: ['KeyF']                    , description: 'Open filter menu'           },
      { keys: ['x']              , codes: ['KeyX']                    , description: 'Select items'               },
      { keys: ['arrowleft']      , codes: ['ArrowLeft']               , description: 'Collapse item'              },
      { keys: ['arrowdown']      , codes: ['ArrowDown']               , description: 'Move down'                  },

      { keys: ['arrowright']     , codes: ['ArrowRight']              , description: 'Expand item'                },


      { keys: ['e']              , codes: ['KeyE']                    , description: 'Mark done'                  },
      { keys: ['arrowup']        , codes: ['ArrowUp']                 , description: 'Move up'                    },
      { keys: ['shift+arrowup']  , codes: ['ShiftLeft', 'ArrowUp']    , description: 'Select up'                  },

    ],
  },
];

const [hoveredCodes, setHoveredCodes] = createSignal<string[]>([]);

function Kbd(props: { shortcut: string; class?: string }) {
  return (
    <span
      class={cn(
        'inline-flex items-center text-xs px-1.5 py-0.5 rounded-sm uppercase transition-colors',
        'border border-edge-muted bg-ink/4 text-ink-muted',
        'group-hover:border-accent/30 group-hover:bg-accent/10 group-hover:text-accent',
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
      class="group flex items-center gap-2 py-1.5 rounded-md hover:bg-surface-secondary/50 transition-colors"
      onMouseEnter={() => setHoveredCodes(props.item.codes)}
      onMouseLeave={() => setHoveredCodes([])}
    >
      <div class="shrink-0 flex items-center gap-1 uppercase">
        <Index each={props.item.keys}>
          {(key, index) => (
            <>
              <Kbd shortcut={key()} />
              {props.spacer && index < props.item.keys.length - 1 && (
                <span class="text-ink-muted text-xs lowercase px-1">{props.spacer}</span>
              )}
            </>
          )}
        </Index>
      </div>
      <span class="text-sm text-ink-muted group-hover:text-accent transition-colors">
        {props.item.description}
      </span>
    </div>
  );
}

function ShortcutSectionComponent(props: { section: ShortcutSection }) {
  return (
    <div class="mb-3">
      <h3 class="font-medium text-lg mb-2 flex items-center gap-2">
        {props.section.title}
      </h3>
      <div class="flex flex-col">
        <For each={props.section.items}>
          {(item) => <ShortcutRow item={item} spacer="or" />}
        </For>
      </div>
    </div>
  );
}

function ShortcutsContent() {
  return (
    <>
      <Panel.Header class="px-6">
        <div class="text-sm font-semibold">Keyboard Shortcuts</div>
      </Panel.Header>

      <Panel.Toolbar class="h-full px-6 py-2">
        <Keyboard keys={hoveredCodes()} />
      </Panel.Toolbar>

      <Panel.Body scroll>
        <div class="px-6 py-2 @container">
          <div class="grid grid-cols-1 @[600px]:grid-cols-2 gap-x-6">
            {/* Core - left column */}
            <ShortcutSectionComponent section={shortcutSections[0]} />

            {/* Splits - right column */}
            <ShortcutSectionComponent section={shortcutSections[1]} />

            {/* Unified List - spans both columns with its own 2-column layout */}
            <div class="@[600px]:col-span-2">
              <h3 class="font-medium text-lg mb-2 flex items-center gap-2">
                {shortcutSections[2].title}
              </h3>
              <div class="grid grid-cols-1 @[600px]:grid-cols-2 gap-x-6">
                <For each={shortcutSections[2].items}>
                  {(item) => <ShortcutRow item={item} spacer="or" />}
                </For>
              </div>
            </div>
          </div>
        </div>
      </Panel.Body>
    </>
  );
}

export function Shortcuts() {
  return (
    <div class="h-full overflow-hidden flex justify-center p-2">
      <div class="max-w-200 size-full">
        <Panel depth={2} class="h-full overflow-hidden text-ink">
          <ShortcutsContent />
        </Panel>
      </div>
    </div>
  );
}
