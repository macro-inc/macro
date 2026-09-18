/**
 * One file's diff rendered by Pierre's vanilla `FileDiff`, with Macro's
 * review notes hung under their lines and Pierre's gutter utility (the "+"
 * that appears on hover, draggable over a range) to leave one.
 *
 * Pierre renders inside a shadow root but slots annotation content from
 * the light DOM, so the note UI here is ordinary Solid markup mounted with
 * `render` into the elements Pierre asks for.
 */

import {
  type DiffLineAnnotation,
  FileDiff,
  type FileDiffMetadata,
  type FileDiffOptions,
  type SelectedLineRange,
} from '@pierre/diffs';
import {
  createEffect,
  createMemo,
  type JSX,
  on,
  onCleanup,
  onMount,
} from 'solid-js';
import { render } from 'solid-js/web';
import type { NoteAnchor, ReviewNote } from '../core/review-notes';
import { NoteAnnotation } from './NoteAnnotation';

export type DiffStyleValue = 'unified' | 'split';

/** Options that never change for the pane's diffs. */
const BASE_OPTIONS = {
  diffIndicators: 'bars',
  // The file card renders its own header.
  disableFileHeader: true,
  overflow: 'wrap',
  hunkSeparators: 'line-info-basic',
  lineDiffType: 'word-alt',
  expansionLineCount: 20,
  lineHoverHighlight: 'line',
} satisfies FileDiffOptions<string>;

/**
 * CSS variables Pierre reads inside its shadow DOM, pointed at Macro's
 * typography tokens so the diff matches the surrounding mono text.
 */
const DIFF_STYLE_VARIABLES: JSX.CSSProperties = {
  '--diffs-font-family': 'var(--font-mono)',
  '--diffs-font-size': '0.75rem',
  '--diffs-line-height': '18px',
  '--diffs-tab-size': '2',
  '--diffs-gap-block': '0',
  '--diffs-min-number-column-width': '4ch',
};

/** One annotation per annotated line: the anchor the notes hang from. */
function annotationKey(side: NoteAnchor['side'], lineNumber: number): string {
  return `${side}:${lineNumber}`;
}

export function PierreFileDiff(props: {
  path: string;
  diff: FileDiffMetadata;
  diffStyle: DiffStyleValue;
  themeType: 'light' | 'dark';
  notes: ReviewNote[];
  composing: NoteAnchor | undefined;
  onOpenNote?: (anchor: NoteAnchor) => void;
  onCancelNote: () => void;
  onAddNote: (anchor: NoteAnchor, text: string) => void;
  onRemoveNote: (id: string) => void;
}) {
  let container!: HTMLDivElement;
  let instance: FileDiff<string> | undefined;
  const roots = new Map<string, () => void>();

  const disposeRoots = () => {
    for (const dispose of roots.values()) dispose();
    roots.clear();
  };

  // Notes hang from the last line of their range, like GitHub's review
  // comments; the editor for a new note does the same.
  const annotations = createMemo((): DiffLineAnnotation<string>[] => {
    const keys = new Map<string, DiffLineAnnotation<string>>();
    const add = (side: NoteAnchor['side'], lineNumber: number) => {
      const key = annotationKey(side, lineNumber);
      if (!keys.has(key)) keys.set(key, { side, lineNumber, metadata: key });
    };
    for (const note of props.notes) add(note.side, note.endLineNumber);
    const composing = props.composing;
    if (composing) add(composing.side, composing.endLineNumber);
    return [...keys.values()].sort(
      (a, b) => a.lineNumber - b.lineNumber || a.side.localeCompare(b.side)
    );
  });

  const notesAt = (key: string) =>
    props.notes.filter(
      (note) => annotationKey(note.side, note.endLineNumber) === key
    );
  const composingAt = (key: string) => {
    const composing = props.composing;
    return composing &&
      annotationKey(composing.side, composing.endLineNumber) === key
      ? composing
      : undefined;
  };

  const renderAnnotation = (annotation: DiffLineAnnotation<string>) => {
    const key = annotation.metadata;
    roots.get(key)?.();
    const element = document.createElement('div');
    roots.set(
      key,
      render(
        () => (
          <NoteAnnotation
            notes={notesAt(key)}
            composing={composingAt(key)}
            onAdd={props.onAddNote}
            onCancel={props.onCancelNote}
            onRemove={props.onRemoveNote}
          />
        ),
        element
      )
    );
    return element;
  };

  const onGutterUtilityClick = (range: SelectedLineRange) => {
    props.onOpenNote?.({
      path: props.path,
      side: range.side ?? 'additions',
      lineNumber: Math.min(range.start, range.end),
      endLineNumber: Math.max(range.start, range.end),
    });
  };

  const currentOptions = (): FileDiffOptions<string> => ({
    ...BASE_OPTIONS,
    diffStyle: props.diffStyle,
    themeType: props.themeType,
    renderAnnotation,
    enableGutterUtility: props.onOpenNote !== undefined,
    onGutterUtilityClick: props.onOpenNote ? onGutterUtilityClick : undefined,
  });

  onMount(() => {
    instance = new FileDiff<string>(currentOptions());
  });

  // A new diff or layout re-renders from scratch; a change to the notes
  // re-renders too, since Pierre only stores annotations handed to
  // `setLineAnnotations` and paints them on the next render. Elements for
  // unchanged annotations are kept across renders. A layout change must be
  // forced: Pierre otherwise treats unchanged content as a partial render.
  createEffect(
    on(
      [() => props.diff, () => props.diffStyle, annotations],
      ([diff, diffStyle, list], previous) => {
        if (!instance) return;
        instance.setOptions(currentOptions());
        instance.render({
          fileDiff: diff,
          containerWrapper: container,
          lineAnnotations: list,
          forceRender: previous !== undefined && previous[1] !== diffStyle,
        });
      }
    )
  );

  // Pierre keeps the gutter selection lit while the note editor is open;
  // adding or cancelling the note lets the line go.
  createEffect(
    on(
      () => props.composing,
      (composing) => {
        if (!composing) instance?.setSelectedLines(null);
      },
      { defer: true }
    )
  );

  createEffect(
    on(
      () => props.themeType,
      (themeType) => instance?.setThemeType(themeType),
      { defer: true }
    )
  );

  onCleanup(() => {
    disposeRoots();
    instance?.cleanUp();
    instance = undefined;
  });

  return (
    <div
      ref={container}
      class="overflow-hidden bg-surface"
      style={DIFF_STYLE_VARIABLES}
    />
  );
}
