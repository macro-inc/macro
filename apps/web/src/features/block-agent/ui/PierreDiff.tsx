/**
 * Syntax-highlighted file diffs rendered with @pierre/diffs.
 *
 * Pure component: props in, JSX out. Each file gets a path header and a
 * unified diff rendered by pierre's vanilla `FileDiff` component, which
 * mounts a `<diffs-container>` custom element (shadow DOM) inside our
 * wrapper div and computes the diff from full before/after contents.
 *
 * Choices, for the record:
 * - Entry point: `FileDiff.render({ oldFile, newFile })` — takes raw
 *   before/after contents directly (`oldFile: null` marks a new file),
 *   matching our wire shape. No patch parsing on our side.
 * - Highlighting runs in a shared, lazy worker pool. The line limit also
 *   bounds diff calculation and DOM work, which still run on the main thread.
 * - Theme: pierre's built-in `pierre-light`/`pierre-dark` pair (its
 *   default). Macro flags dark mode via `html[data-theme-light="false"]`
 *   (see features/theme/signals/themeReactive.ts), so we watch that
 *   attribute and drive `setThemeType('light' | 'dark')` explicitly
 *   instead of pierre's OS-preference "system" mode.
 */

import {
  type FileDiffOptions,
  FileDiff as PierreFileDiffInstance,
  type ThemeTypes,
} from '@pierre/diffs';
import type { WorkerPoolManager } from '@pierre/diffs/worker';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import { useDiffWorkers } from './diff-workers';
import type { FileDiff } from './types';

/**
 * Files whose before or after side exceeds this many lines get a plain
 * placeholder instead of a rendered diff, bounding diff calculation and DOM size.
 */
const MAX_RENDER_LINES = 2000;

/** Options for pierre's diff instance: static, unified, header-less. */
const DIFF_OPTIONS = {
  diffStyle: 'unified',
  diffIndicators: 'bars',
  // We render our own path header per file.
  disableFileHeader: true,
  overflow: 'wrap',
  hunkSeparators: 'line-info-basic',
  lineDiffType: 'none',
  expansionLineCount: 20,
} satisfies FileDiffOptions<undefined>;

/**
 * CSS variables pierre reads inside its shadow DOM, pointed at Macro's
 * typography tokens so the diff matches surrounding font-mono text-xs UI.
 */
const DIFF_STYLE_VARIABLES: JSX.CSSProperties = {
  '--diffs-font-family': 'var(--font-mono)',
  '--diffs-font-size': '0.75rem',
  '--diffs-line-height': '18px',
  '--diffs-tab-size': '2',
  '--diffs-gap-block': '0',
  '--diffs-min-number-column-width': '4ch',
};

function currentThemeType(): 'light' | 'dark' {
  return document.documentElement.dataset.themeLight === 'false'
    ? 'dark'
    : 'light';
}

/**
 * Macro's light/dark state as a signal, tracked off the
 * `data-theme-light` attribute the theme feature keeps on `<html>`.
 */
function createThemeType(): () => 'light' | 'dark' {
  const [themeType, setThemeType] = createSignal(currentThemeType());
  const observer = new MutationObserver(() => setThemeType(currentThemeType()));
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme-light'],
  });
  onCleanup(() => observer.disconnect());
  return themeType;
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split('\n').length;
}

/** Plain note shown in place of a diff body. */
function DiffNote(props: { children: JSX.Element }) {
  return (
    <div class="rounded border border-edge-muted px-3 py-2 font-mono text-xs text-ink-muted">
      {props.children}
    </div>
  );
}

/** Mounts one pierre diff instance for a single file. */
function PierreFileView(props: {
  diff: FileDiff;
  themeType: () => 'light' | 'dark';
  workers: WorkerPoolManager;
}) {
  let container!: HTMLDivElement;
  let instance: PierreFileDiffInstance | undefined;
  const [failed, setFailed] = createSignal(false);

  onCleanup(() => {
    instance?.cleanUp();
    instance = undefined;
  });

  // Content: (re)render whenever the file's path or texts change.
  createEffect(() => {
    if (failed()) return;
    const name = props.diff.path;
    const oldText = props.diff.oldText;
    const newText = props.diff.newText;
    try {
      instance ??= new PierreFileDiffInstance(
        {
          ...DIFF_OPTIONS,
          themeType: untrack(props.themeType) satisfies ThemeTypes,
        },
        props.workers
      );
      // Paths repeat across edits and sessions. Each content revision needs its
      // own worker-cache identity, including when an open call streams an update.
      const revision = crypto.randomUUID();
      instance.render({
        // `== null` deliberately: the wire declares `oldText: string | null`,
        // but crossing the WASM boundary serde turns `None` into `undefined`.
        oldFile:
          oldText == null
            ? null
            : { name, contents: oldText, cacheKey: `${revision}:old` },
        newFile: { name, contents: newText, cacheKey: `${revision}:new` },
        containerWrapper: container,
      });
    } catch (error) {
      // Pierre throws on inputs it cannot diff (e.g. identical contents
      // slipping through); degrade to a note rather than a broken card.
      console.error('[pierre-diff] render failed', {
        path: props.diff.path,
        newFile: oldText === null,
        error,
      });
      instance?.cleanUp();
      instance = undefined;
      setFailed(true);
    }
  });

  // Theme: flip pierre's light/dark styles alongside Macro's theme.
  createEffect(() => {
    const themeType = props.themeType();
    instance?.setThemeType(themeType);
  });

  return (
    <Show
      when={!failed()}
      fallback={<DiffNote>diff could not be rendered</DiffNote>}
    >
      <div
        ref={container}
        class="overflow-hidden rounded border border-edge-muted"
        style={DIFF_STYLE_VARIABLES}
      />
    </Show>
  );
}

/** One file's block: path header plus diff body (or a size fallback). */
function FileDiffBlock(props: {
  diff: FileDiff;
  themeType: () => 'light' | 'dark';
  workers: WorkerPoolManager;
}) {
  const longestSide = createMemo(() =>
    Math.max(lineCount(props.diff.oldText ?? ''), lineCount(props.diff.newText))
  );

  return (
    <div class="flex flex-col gap-1">
      <span class="truncate font-mono text-xs text-ink-extra-muted">
        {props.diff.path}
      </span>
      <Show
        when={longestSide() <= MAX_RENDER_LINES}
        fallback={
          <DiffNote>
            large diff ({longestSide().toLocaleString()} lines)
          </DiffNote>
        }
      >
        <PierreFileView
          diff={props.diff}
          themeType={props.themeType}
          workers={props.workers}
        />
      </Show>
    </div>
  );
}

/**
 * Renders each file's before/after contents as a syntax-highlighted
 * unified diff, one block per file.
 */
export function PierreDiff(props: { diffs: FileDiff[] }): JSX.Element {
  const themeType = createThemeType();
  const workers = useDiffWorkers();
  const readyPool = () => {
    const state = workers();
    return state.kind === 'ready' ? state.pool : undefined;
  };

  return (
    <div class="flex flex-col gap-2">
      <Show
        when={readyPool()}
        fallback={
          <DiffNote>
            {workers().kind === 'failed'
              ? 'diff could not be rendered'
              : 'Loading diff…'}
          </DiffNote>
        }
      >
        {(pool) => (
          <For each={props.diffs}>
            {(diff) => (
              <FileDiffBlock
                diff={diff}
                themeType={themeType}
                workers={pool()}
              />
            )}
          </For>
        )}
      </Show>
    </div>
  );
}
