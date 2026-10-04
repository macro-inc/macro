/**
 * The ribbon: a strip of tabs (with contextual tabs for the selection) and
 * the active tab's controls on one line, as in PowerPoint's simplified
 * ribbon. What each control does comes from `RibbonEnv`.
 */

import type {
  DeckOutline,
  PresetPath,
  ShapeOutline,
  SlideOutline,
} from '@core/pptx-engine/types';
import {
  createContext,
  createSignal,
  For,
  type JSX,
  Show,
  useContext,
} from 'solid-js';
import type { Swatch } from '../../core/palette';
import type { DeckSetup } from '../../primitives/create-deck-setup';
import type { EditorCommands } from '../../primitives/create-editor-commands';

export interface RibbonEnv {
  commands: EditorCommands;
  readonly: () => boolean;
  deck: () => DeckOutline | undefined;
  slide: () => SlideOutline | undefined;
  /** The selected shapes (the edited shape while typing). */
  selection: () => ShapeOutline[];
  editingText: () => boolean;
  themeGrid: () => Swatch[][];
  standardColors: Swatch[];
  presetPaths?: (
    names: string[],
    w: number,
    h: number
  ) => Promise<Record<string, PresetPath[]>>;
  history: () => { canUndo: boolean; canRedo: boolean };
  undo: () => void;
  redo: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  formatPainter: {
    active: () => boolean;
    sticky: () => boolean;
    /** Copies the selection's formatting; `keep` paints until Escape. */
    arm: (keep: boolean) => Promise<void>;
    cancel: () => void;
  };
  /** Opens the format pane on a section. */
  openFormatPane: (section?: 'shape' | 'text' | 'size' | 'background') => void;
  /** Starts the slide show; `presenter` opens Presenter View. */
  present: (fromCurrent: boolean, presenter?: boolean) => void;
  find: (replace: boolean) => void;
  zoom: () => number | 'fit';
  setZoom: (zoom: number | 'fit') => void;
  /** The Animations tab and pane. */
  animation: {
    pane: () => boolean;
    togglePane: () => void;
    /** The animation picked in the pane (playback position). */
    picked: () => number | undefined;
    pick: (index?: number) => void;
    /** The animation the tab shows: the picked one, else the selection's first. */
    current: () => number | undefined;
    /** The animations timing and option edits apply to. */
    selected: () => number[];
    /** Plays the slide's animations in place. */
    preview: () => void;
  };
  /** Normal view or the slide sorter. */
  sorter: () => boolean;
  setSorter: (on: boolean) => void;
  notesVisible: () => boolean;
  toggleNotes: () => void;
  download: () => void;
  /** Fonts picked recently, most recent first. */
  recentFonts: () => string[];
  /** Extra tabs (tables, charts) contributed by the view. */
  extraTabs?: () => RibbonTab[];
  /** Header & Footer, slide size, and sections (dialogs and section view state). */
  deckSetup?: DeckSetup;
}

const RibbonContext = createContext<RibbonEnv>();

export function useRibbon(): RibbonEnv {
  const env = useContext(RibbonContext);
  if (!env) throw new Error('RibbonProvider is required');
  return env;
}

export interface RibbonTab {
  id: string;
  label: string;
  /** Shown only for the current selection, highlighted. */
  contextual?: boolean;
  content: () => JSX.Element;
}

export function Ribbon(props: {
  env: RibbonEnv;
  tabs: RibbonTab[];
  /** Kept in place while clicking, so typing continues afterwards. */
  keepFocus: boolean;
  start?: JSX.Element;
  end?: JSX.Element;
  /** Called with the id of the tab chosen. */
  onTabChange?: (id: string) => void;
}) {
  const [active, setActiveRaw] = createSignal('home');
  const setActive = (id: string) => {
    setActiveRaw(id);
    props.onTabChange?.(id);
  };
  const current = () =>
    props.tabs.find((t) => t.id === active()) ?? props.tabs[0];
  // Clicks must not move focus out of the text being edited.
  const holdFocus = (e: Event) => {
    const target = e.target as HTMLElement;
    if (
      props.keepFocus &&
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLSelectElement)
    )
      e.preventDefault();
  };
  return (
    <RibbonContext.Provider value={props.env}>
      <div
        class="flex shrink-0 flex-col border-edge-muted border-b bg-panel"
        data-testid="pptx-toolbar"
        onPointerDown={holdFocus}
        onMouseDown={holdFocus}
      >
        <div class="flex h-8 items-center gap-1 px-2">
          {props.start}
          <div role="tablist" aria-label="Ribbon" class="flex items-center">
            <For each={props.tabs}>
              {(tab) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={current()?.id === tab.id}
                  data-testid={`pptx-tab-${tab.id}`}
                  class="relative h-8 px-2.5 font-medium text-xs"
                  classList={{
                    'text-ink': current()?.id === tab.id,
                    'text-ink-muted hover:text-ink':
                      current()?.id !== tab.id && !tab.contextual,
                    'text-accent': !!tab.contextual,
                  }}
                  onClick={() => setActive(tab.id)}
                >
                  {tab.label}
                  <Show when={current()?.id === tab.id}>
                    <span class="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />
                  </Show>
                </button>
              )}
            </For>
          </div>
          <div class="flex-1" />
          {props.end}
        </div>
        <div
          role="toolbar"
          aria-label={current()?.label}
          class="flex h-10 items-center overflow-x-auto overflow-y-hidden px-1.5 [scrollbar-width:thin]"
        >
          <Show when={current()} keyed>
            {(tab) => tab.content()}
          </Show>
        </div>
      </div>
    </RibbonContext.Provider>
  );
}
