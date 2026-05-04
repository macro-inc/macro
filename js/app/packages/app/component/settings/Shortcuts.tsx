import { IS_MAC } from '@core/constant/isMac';
import { Hotkey } from '@core/component/Hotkey';
import { Panel } from '@ui';
import { cn } from '@ui/utils/classname';
import { For, Index, type JSX } from 'solid-js';
import { Keyboard } from '@ui';

const cmdOrCtrl = IS_MAC ? 'cmd' : 'ctrl';

type ShortcutItem = {
  keys: string[];
  description: JSX.Element;
};

type ShortcutSection = {
  title: string;
  items: ShortcutItem[];
};

const shortcutSections: ShortcutSection[] = [
  {
    title: 'Core',
    items: [
      { keys: ['c']             , description: 'Open the create menu'   },
      { keys: [`${cmdOrCtrl}+k`], description: 'Open the command menu'  },
      { keys: ['g']             , description: 'Go to a view'           },
      { keys: ['/']             , description: 'Go to search view'      },
      { keys: [`${cmdOrCtrl}+f`], description: 'Search in current view' },
      { keys: [`${cmdOrCtrl}+j`], description: 'Focus AI chat'          },
      { keys: [`${cmdOrCtrl}+;`], description: 'Open settings panel'    },
    ],
  },
  {
    title: 'Splits',
    items: [
      { keys: ['\\']                         , description: 'Create a split'              },
      { keys: [`cmd+escape`]                 , description: 'Go home / close split'       },
      { keys: ['shift+escape']               , description: 'Spotlight split'             },
      { keys: ['shift+h', 'shift+arrowleft'] , description: 'Focus split to the left'     },
      { keys: ['shift+l', 'shift+arrowright'], description: 'Focus split to the right'    },
      { keys: [`opt+[`]                      , description: 'Go back in current split'    },
      { keys: [`opt+]`]                      , description: 'Go forward in current split' },
    ],
  },
  {
    title: 'Unified List',
    items: [
      { keys: ['j', 'arrowdown']            , description: 'Move down'                  },
      { keys: ['k', 'arrowup']              , description: 'Move up'                    },
      { keys: ['shift+j', 'shift+arrowdown'], description: 'Select down'                },
      { keys: ['shift+k', 'shift+arrowup']  , description: 'Select up'                  },
      { keys: ['e']                         , description: 'Mark done'                  },
      { keys: ['x']                         , description: 'Select items'               },
      { keys: ['f']                         , description: 'Open filter menu'           },
      { keys: ['h', 'arrowleft']            , description: 'Collapse item'              },
      { keys: ['l', 'arrowright']           , description: 'Expand item'                },
      { keys: ['space']                     , description: 'Preview item'               },
      { keys: ['enter']                     , description: 'Open item in current split' },
      { keys: ['shift+enter']               , description: 'Open item in a new split'   },
    ],
  },
];

function Kbd(props: { shortcut: string; class?: string }) {
  return (
    <span
      class={cn(
        'inline-flex items-center text-xs px-1.5 py-0.5 rounded-sm border border-edge-muted bg-ink/4 text-ink-muted uppercase',
        props.class
      )}
    >
      <Hotkey shortcut={props.shortcut} class="flex gap-[2px]" lowercase />
    </span>
  );
}

function ShortcutRow(props: { item: ShortcutItem; spacer?: string }) {
  return (
    <div class="flex items-center gap-2 py-1.5 rounded-md hover:bg-panel-secondary/50 transition-colors">
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
      <span class="text-ink-muted text-sm">{props.item.description}</span>
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
    <div class="flex flex-col h-full overflow-hidden">
      <div class="relative flex items-center justify-between h-10 px-6 shrink-0 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-edge-muted after:content-['']">
        <div class="text-sm font-semibold">Keyboard Shortcuts</div>
      </div>

      <div class="flex-1 overflow-auto px-6 py-2 @container">
        <Keyboard/>

        <div class="grid grid-cols-1 @[600px]:grid-cols-2 gap-x-6">

          {/* Core - left column */}
          <ShortcutSectionComponent section={shortcutSections[0]} />

          {/* Splits - right column */}
          <ShortcutSectionComponent section={shortcutSections[1]} />

          {/* Unified List - spans both columns with its own 2-column layout */}
          <div class="@[600px]:col-span-2">
            <div class="mb-3">
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
      </div>
    </div>
  );
}

export function Shortcuts() {
  return (
    <div class="h-full overflow-hidden flex justify-center p-2">
      <div class="max-w-2xl w-full h-full">
        <Panel depth={2} class="h-full overflow-hidden">
          <div class="text-ink h-full">
            <ShortcutsContent />
          </div>
        </Panel>
      </div>
    </div>
  );
}
