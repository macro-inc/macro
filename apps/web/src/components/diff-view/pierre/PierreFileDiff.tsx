/**
 * One file's diff rendered by Pierre's vanilla `FileDiff`, with a host's
 * content hung under its lines and Pierre's gutter utility (the "+" that
 * appears on hover, draggable over a range) to pick lines for more.
 *
 * Pierre renders inside a shadow root but slots annotation content from
 * the light DOM, so the host's content is ordinary Solid markup mounted
 * with `render` into the elements Pierre asks for.
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
import type { DiffStyle } from '../model/diff-file';
import type { LineAnnotation, LineRange } from '../model/lines';
import {
  PIERRE_APP_COLORS,
  PIERRE_STYLE_VARIABLES,
  type ThemeType,
} from './theme';

const DIFF_STYLE = { ...PIERRE_STYLE_VARIABLES, ...PIERRE_APP_COLORS };

/** Options that never change for the view's diffs. */
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

export function PierreFileDiff(props: {
  path: string;
  diff: FileDiffMetadata;
  diffStyle: DiffStyle;
  themeType: ThemeType;
  /** Where host content hangs on this file. */
  annotations: LineAnnotation[];
  /** The content under one of `annotations`, by its key. */
  renderAnnotation: (key: string) => JSX.Element;
  /** The lines to light on this file, such as a range being annotated. */
  selection: LineRange | undefined;
  /** Turns on the gutter "+"; omit for a diff whose lines cannot be picked. */
  onSelectLines?: (range: LineRange) => void;
  /** CSS injected into Pierre's shadow root. */
  unsafeCSS?: string;
}) {
  let container!: HTMLDivElement;
  let instance: FileDiff<string> | undefined;
  const roots = new Map<string, () => void>();

  const disposeRoots = () => {
    for (const dispose of roots.values()) dispose();
    roots.clear();
  };

  const annotations = createMemo((): DiffLineAnnotation<string>[] =>
    props.annotations
      .map(({ key, side, lineNumber }) => ({ side, lineNumber, metadata: key }))
      .sort(
        (a, b) => a.lineNumber - b.lineNumber || a.side.localeCompare(b.side)
      )
  );

  const renderAnnotation = (annotation: DiffLineAnnotation<string>) => {
    const key = annotation.metadata;
    roots.get(key)?.();
    const element = document.createElement('div');
    roots.set(
      key,
      render(() => props.renderAnnotation(key), element)
    );
    return element;
  };

  const onGutterUtilityClick = (range: SelectedLineRange) => {
    props.onSelectLines?.({
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
    unsafeCSS: props.unsafeCSS,
    renderAnnotation,
    enableGutterUtility: props.onSelectLines !== undefined,
    onGutterUtilityClick: props.onSelectLines
      ? onGutterUtilityClick
      : undefined,
  });

  onMount(() => {
    instance = new FileDiff<string>(currentOptions());
  });

  // A new diff or layout re-renders from scratch; a change to the
  // annotations re-renders too, since Pierre only stores annotations handed
  // to `setLineAnnotations` and paints them on the next render. Elements for
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

  // Pierre lights one range per file. It follows the host: the range being
  // annotated, one the host points at (a focused comment), or none.
  createEffect(
    on(
      () => props.selection,
      (selection) => {
        instance?.setSelectedLines(
          selection
            ? {
                start: selection.lineNumber,
                end: selection.endLineNumber,
                side: selection.side,
              }
            : null,
          { notify: false }
        );
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
      style={DIFF_STYLE}
    />
  );
}
