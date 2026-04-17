import { IS_MAC } from '@core/constant/isMac';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { Hotkey } from '@core/component/Hotkey';
import { createSignal, For, type JSX } from 'solid-js';

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
      { keys: ['c'], description: 'Open the create menu' },
      { keys: [`${cmdOrCtrl}+k`], description: 'Open the command menu' },
      {
        keys: ['g'],
        description: (
          <>
            Go to a view (e.g. <Kbd shortcut="g" /> then <Kbd shortcut="i" /> for inbox)
          </>
        ),
      },
      { keys: ['/'], description: 'Go to search view' },
      { keys: [`${cmdOrCtrl}+f`], description: 'Search in current view' },
      { keys: [`${cmdOrCtrl}+j`], description: 'Focus AI chat' },
      { keys: [`${cmdOrCtrl}+;`], description: 'Open settings panel' },
    ],
  },
  {
    title: 'Unified List',
    items: [
      { keys: ['j', 'arrowdown'], description: 'Move down' },
      { keys: ['k', 'arrowup'], description: 'Move up' },
      { keys: ['shift+j', 'shift+arrowdown'], description: `Select down` },
      { keys: ['shift+k', 'shift+arrowup'], description: `Select up` },
      { keys: ['e'], description: 'Mark done' },
      {
        keys: ['x'],
        description: (
          <>
            Select items (then <Kbd shortcut={`${cmdOrCtrl}+k`} /> to bring up actions)
          </>
        ),
      },
      { keys: ['f'], description: 'Open filter menu' },
      { keys: ['h', 'arrowleft'], description: 'Collapse item' },
      { keys: ['l', 'arrowright'], description: 'Expand item' },
      { keys: ['space'], description: 'Preview item' },
      { keys: ['click', 'enter'], description: 'Open item in current split' },
      { keys: ['shift+click', 'shift+enter'], description: 'Open item in a new split' },
    ],
  },
  {
    title: 'Splits',
    items: [
      { keys: ['\\', `${cmdOrCtrl}+\\`], description: 'Create a split' },
      { keys: [`opt+escape`], description: 'Go home in current split, close split if home' },
      { keys: ['shift+escape'], description: 'Spotlight split' },
      { keys: ['shift+h', 'shift+arrowleft'], description: 'Focus split to the left' },
      { keys: ['shift+l', 'shift+arrowright'], description: 'Focus split to the right' },
      { keys: [`opt+[`], description: 'Go back in current split' },
      { keys: [`opt+]`], description: 'Go forward in current split' },
    ],
  },
];

function Kbd(props: { shortcut: string; class?: string }) {
  return (
    <span
      class={`inline-flex items-center font-mono text-xs px-1.5 py-0.5 rounded border border-accent/30 bg-accent/10 text-accent uppercase ${props.class ?? ''}`}
    >
      <Hotkey shortcut={props.shortcut} class="flex gap-[2px]" lowercase />
    </span>
  );
}

function ShortcutRow(props: { item: ShortcutItem }) {
  return (
    <div class="flex items-center gap-2 py-1.5 px-3 rounded-md hover:bg-panel-secondary/50 transition-colors">
      <div class="shrink-0 flex items-center gap-1 uppercase">
        <For each={props.item.keys}>
          {(key) => <Kbd shortcut={key} />}
        </For>
      </div>
      <span class="text-ink-muted text-sm">{props.item.description}</span>
    </div>
  );
}

function ShortcutSectionComponent(props: { section: ShortcutSection }) {
  return (
    <div class="mb-3">
      <h3 class="text-accent font-medium text-lg mb-2 px-3 flex items-center gap-2">
        {/*<span class="w-1.5 h-1.5 rounded-full bg-accent" />*/}
        {props.section.title}
      </h3>
      <div class="flex flex-col">
        <For each={props.section.items}>
          {(item) => <ShortcutRow item={item} />}
        </For>
      </div>
    </div>
  );
}

export function Shortcuts() {
  const [scrollRef, setScrollRef] = createSignal<HTMLDivElement>();

  return (
    <div class="absolute inset-0 bg-panel">
      <div
        ref={setScrollRef}
        class="absolute inset-0 overflow-auto p-6 scrollbar-hidden"
      >
        <div class="max-w-2xl mx-auto">
          <div class="mb-4">
            <h2 class="text-xl font-semibold text-ink mb-2">Keyboard Shortcuts</h2>
            <p class="text-ink-muted text-sm">
              Shortcuts without a {cmdOrCtrl}/option modifier key require text inputs to be unfocused. For example, pressing <kbd>j</kbd> in a document will insert a j, but will move down the list if the document text is unfocused.
            </p>
          </div>

          <For each={shortcutSections}>
            {(section) => <ShortcutSectionComponent section={section} />}
          </For>
        </div>
      </div>
      <CustomScrollbar scrollContainer={scrollRef} />
    </div>
  );
}
