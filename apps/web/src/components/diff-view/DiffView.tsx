/**
 * A stack of file diffs from one patch. `Root` pairs the host's files with
 * the patch and holds the view's state; a list renderer (`Stack`) draws the
 * files, and the host composes each file's header and whatever hangs under
 * its lines. Toolbar parts (`CollapseAll`, `StyleToggle`) go wherever the
 * host puts them inside `Root`.
 */

import ArrowsInIcon from '@phosphor/arrows-in.svg';
import ArrowsOutIcon from '@phosphor/arrows-out.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import { Button, Card, cn, SegmentedControl } from '@ui';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { createDiffCollapse, type DiffCollapse } from './collapse';
import { DiffCounts } from './DiffCounts';
import { type DiffFile, type DiffStyle, splitPath } from './model/diff-file';
import type { LineAnnotation, LineRange } from './model/lines';
import { type DiffEntry, matchFilesToDiffs, parsePatch } from './model/patch';
import { PierreFileDiff } from './pierre/PierreFileDiff';
import { createThemeType, type ThemeType } from './pierre/theme';
import { StatusLetter } from './StatusLetter';

type DiffViewContextValue = {
  entries: Accessor<DiffEntry[]>;
  diffStyle: Accessor<DiffStyle>;
  themeType: Accessor<ThemeType>;
  collapse: DiffCollapse;
  active: Accessor<string | undefined>;
};

const DiffViewContext = createContext<DiffViewContextValue>();
const FileContext = createContext<DiffEntry>();

function useDiffView(): DiffViewContextValue {
  const context = useContext(DiffViewContext);
  if (!context) throw new Error('DiffView parts must be inside DiffView.Root');
  return context;
}

function useDiffFile(): DiffEntry {
  const entry = useContext(FileContext);
  if (!entry) throw new Error('DiffView file parts must be inside a file');
  return entry;
}

function Root(
  props: ParentProps<{
    files: readonly DiffFile[];
    /** The unified patch behind `files`; empty when no file has diff text. */
    patch: string;
    diffStyle: DiffStyle;
    /** Defaults to collapse state kept in memory. */
    collapse?: DiffCollapse;
    /** The file to bring into view; each change scrolls to it again. */
    active?: string;
  }>
) {
  const diffs = createMemo(() => parsePatch(props.patch));
  const entries = createMemo(() => matchFilesToDiffs(props.files, diffs()));
  const view: DiffViewContextValue = {
    entries,
    diffStyle: () => props.diffStyle,
    themeType: createThemeType(),
    collapse:
      props.collapse ??
      createDiffCollapse(() => props.files.map((file) => file.path)),
    active: () => props.active,
  };
  return (
    <DiffViewContext.Provider value={view}>
      {props.children}
    </DiffViewContext.Provider>
  );
}

/** What a list renderer asks of the host for each file. */
type DiffListProps = {
  /** What a file's sticky header shows; defaults to its caret, path, and counts. */
  header?: (entry: DiffEntry) => JSX.Element;
  /** Where host content hangs on a file. */
  annotations?: (entry: DiffEntry) => LineAnnotation[];
  /** The content under one of a file's annotations. */
  renderAnnotation?: (entry: DiffEntry, key: string) => JSX.Element;
  /**
   * The lines to light, one range at a time: the range being annotated, or one
   * the host points at, such as a focused comment's.
   */
  selection?: Accessor<LineRange | undefined>;
  /** Turns on the gutter "+" for picking lines; omit for a read-only diff. */
  onSelectLines?: (range: LineRange) => void;
  /** A column beside a file's diff, such as margin comments. */
  aside?: (entry: DiffEntry) => JSX.Element;
  /**
   * CSS injected into Pierre's shadow root, e.g. to restyle annotation rows.
   * It targets Pierre's internal markup, so it can break on an upgrade.
   */
  unsafeCSS?: string;
  class?: string;
};

const FLASH_MS = 900;

function DefaultHeader() {
  return (
    <>
      <CollapseButton />
      <FilePath />
      <FileCounts />
    </>
  );
}

/** Plain note shown in place of a diff body. */
function DiffNote(props: { children: JSX.Element }) {
  return (
    <div class="px-3 py-2.5 text-xs text-ink-subtle">{props.children}</div>
  );
}

/** Every file as its own card, each rendered by its own Pierre instance. */
function Stack(props: DiffListProps) {
  const view = useDiffView();
  const cards = new Map<string, HTMLElement>();
  const [flashing, setFlashing] = createSignal<string>();

  // Jumping to a file is a DOM concern: scroll the card in and flash it.
  createEffect(
    on(
      view.active,
      (path) => {
        if (!path) return;
        cards.get(path)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        setFlashing(path);
        const timer = setTimeout(() => setFlashing(undefined), FLASH_MS);
        onCleanup(() => clearTimeout(timer));
      },
      { defer: true }
    )
  );

  // Padding lives on the inner column: on the scroller itself it insets the
  // sticky headers, leaving a band above them where lines scroll into view.
  return (
    <div
      class={cn(
        'min-h-0 min-w-0 flex-1 overflow-y-auto scroll-smooth motion-reduce:scroll-auto',
        props.class
      )}
    >
      <div class="flex min-w-0 flex-col gap-3 p-3 pb-24">
        <For each={view.entries()}>
          {(entry) => {
            const path = () => entry.file.path;
            const collapsed = () => view.collapse.isCollapsed(path());
            const selection = () => {
              const range = props.selection?.();
              return range?.path === path() ? range : undefined;
            };
            return (
              <FileContext.Provider value={entry}>
                <Card
                  ref={(element: HTMLDivElement) => {
                    cards.set(path(), element);
                    onCleanup(() => cards.delete(path()));
                  }}
                  class={cn(
                    'shrink-0 scroll-mt-3 overflow-clip transition',
                    flashing() === path() &&
                      'border-accent ring-2 ring-selected'
                  )}
                  data-path={path()}
                >
                  <header
                    class={cn(
                      'sticky top-0 z-5 flex h-10 items-center gap-1 bg-surface px-1.5',
                      !collapsed() && 'border-b border-edge-muted'
                    )}
                  >
                    {props.header ? props.header(entry) : <DefaultHeader />}
                  </header>
                  <Show when={!collapsed()}>
                    <div class="flex min-w-0">
                      <div class="min-w-0 flex-1">
                        <Show
                          when={!entry.note}
                          fallback={<DiffNote>{entry.note}</DiffNote>}
                        >
                          <Show when={entry.diff}>
                            {(diff) => (
                              <PierreFileDiff
                                path={path()}
                                diff={diff()}
                                diffStyle={view.diffStyle()}
                                themeType={view.themeType()}
                                annotations={props.annotations?.(entry) ?? []}
                                renderAnnotation={(key) =>
                                  props.renderAnnotation?.(entry, key)
                                }
                                selection={selection()}
                                onSelectLines={props.onSelectLines}
                                unsafeCSS={props.unsafeCSS}
                              />
                            )}
                          </Show>
                        </Show>
                      </div>
                      {props.aside?.(entry)}
                    </div>
                  </Show>
                </Card>
              </FileContext.Provider>
            );
          }}
        </For>
      </div>
    </div>
  );
}

/** Shows or hides the file's diff. */
function CollapseButton() {
  const { collapse } = useDiffView();
  const entry = useDiffFile();
  const collapsed = () => collapse.isCollapsed(entry.file.path);
  const base = () => splitPath(entry.file.path).base;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-expanded={!collapsed()}
      aria-label={`${collapsed() ? 'Show' : 'Hide'} ${base()}`}
      tooltip={collapsed() ? 'Show this diff' : 'Hide this diff'}
      onClick={() => collapse.toggle(entry.file.path)}
    >
      <CaretRightIcon
        class={cn(
          'transition-transform duration-100 motion-reduce:transition-none',
          !collapsed() && 'rotate-90'
        )}
      />
    </Button>
  );
}

/** The file's status and path, where a rename shows where it came from. */
function FilePath() {
  const { collapse } = useDiffView();
  const entry = useDiffFile();
  const file = () => entry.file;
  const path = () => splitPath(file().path);
  return (
    <button
      type="button"
      class="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left outline-none focus-visible:outline-2 focus-visible:outline-accent"
      aria-expanded={!collapse.isCollapsed(file().path)}
      title={file().path}
      onClick={() => collapse.toggle(file().path)}
    >
      <StatusLetter kind={file().kind} />
      <span class="flex min-w-0 items-baseline text-xs">
        <Show when={file().previousPath}>
          {(previous) => (
            <span class="truncate text-ink-subtle">
              {previous()}
              <span class="px-1">→</span>
            </span>
          )}
        </Show>
        <span class="min-w-0 shrink truncate text-ink-subtle">
          {path().dir}
        </span>
        <span class="max-w-full shrink-0 truncate font-medium text-ink">
          {path().base}
        </span>
      </span>
    </button>
  );
}

/** The file's added and deleted line totals. */
function FileCounts() {
  const entry = useDiffFile();
  return (
    <span class="flex shrink-0 items-center px-1 text-xs">
      <DiffCounts
        additions={entry.file.additions}
        deletions={entry.file.deletions}
      />
    </span>
  );
}

/** Collapses every diff to its header, or opens them all again. */
function CollapseAll() {
  const { collapse } = useDiffView();
  return (
    <Button
      variant="ghost"
      size="sm"
      tooltip={
        collapse.anyExpanded()
          ? 'Hide every diff, keeping just the file headers'
          : 'Show every diff again'
      }
      onClick={() => collapse.toggleAll()}
    >
      {collapse.anyExpanded() ? <ArrowsInIcon /> : <ArrowsOutIcon />}
      <span>{collapse.anyExpanded() ? 'Collapse all' : 'Expand all'}</span>
    </Button>
  );
}

/** Unified or side-by-side diffs. */
function StyleToggle(props: {
  value: DiffStyle;
  onChange: (style: DiffStyle) => void;
  class?: string;
}) {
  return (
    <SegmentedControl
      size="sm"
      aria-label="Diff layout"
      value={props.value}
      options={[
        { value: 'unified', label: 'Unified' },
        { value: 'split', label: 'Split' },
      ]}
      onChange={props.onChange}
      class={props.class}
    />
  );
}

export const DiffView = {
  Root,
  Stack,
  CollapseButton,
  FilePath,
  FileCounts,
  CollapseAll,
  StyleToggle,
};
