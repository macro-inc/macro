import { IS_MAC } from '@core/constant/isMac';
import { Hotkey } from '@ui';
import { Keyboard, Panel } from '@ui';
import { cn } from '@ui';
import { createSignal, For, Index, type JSX } from 'solid-js';

const cmdOrCtrl = IS_MAC ? 'cmd' : 'ctrl';
const CmdOrCtrl = IS_MAC ? 'MetaLeft' : 'ControlLeft';

interface ShortcutItem {
  /** Display strings for `<Hotkey>`, e.g. ['cmd+k']. Multiple = "any of these works". */
  keys: string[];
  /** `e.code` values to light up on the keyboard when this row is hovered. */
  codes: string[];
  description: JSX.Element;
}

interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
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
      { keys: ['e']              , codes: ['KeyE']                    , description: 'Mark done'                  },
      { keys: ['arrowup']        , codes: ['ArrowUp']                 , description: 'Move up'                    },
      { keys: ['shift+arrowup']  , codes: ['ShiftLeft', 'ArrowUp']    , description: 'Select up'                  },
      { keys: ['arrowright']     , codes: ['ArrowRight']              , description: 'Expand item'                },
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
