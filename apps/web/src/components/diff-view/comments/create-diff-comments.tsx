/**
 * Comments under diff lines, for `DiffView.Stack`: groups a host's items by
 * the line they hang from (the last line of their range, like GitHub), holds
 * the one comment being written, and lights the lines of the thread with
 * focus. The host renders what each line shows; `CommentThread` has the
 * parts for GitHub-style threads.
 *
 * Pierre re-creates a line's element when rows before it change and on every
 * Unified/Split switch, so the draft lives here or with the host, never in
 * the rendered editor.
 */

import { type Accessor, createSignal, type JSX } from 'solid-js';
import type { LineAnnotation, LineRange } from '../model/lines';
import type { DiffEntry } from '../model/patch';

/** A comment being written: where it goes, and what it says so far. */
export type CommentDraft = { range: LineRange; text: string };

/** Everything that hangs under one line of one file. */
export type CommentSpot<T> = {
  readonly path: string;
  /** Posted items ending on this line, earliest start first. */
  readonly items: T[];
  /** The comment being written here, when it is. */
  readonly draft: CommentDraft | undefined;
};

/** The props to spread onto `DiffView.Stack`, and the draft's controls. */
export type DiffComments = {
  annotations: (entry: DiffEntry) => LineAnnotation[];
  renderAnnotation: (entry: DiffEntry, key: string) => JSX.Element;
  selection: Accessor<LineRange | undefined>;
  /** Undefined while the host cannot take comments, which hides the gutter "+". */
  readonly onSelectLines: ((range: LineRange) => void) | undefined;
  draft: Accessor<CommentDraft | undefined>;
  /** Start writing on these lines, such as a reply to a thread. */
  startDraft: (range: LineRange) => void;
  editDraft: (text: string) => void;
  cancelDraft: () => void;
};

const spotKey = (range: Pick<LineRange, 'side' | 'endLineNumber'>) =>
  `${range.side}:${range.endLineNumber}`;

export function createDiffComments<T>(options: {
  /** Every posted item on every file. */
  items: Accessor<readonly T[]>;
  rangeOf: (item: T) => LineRange;
  /** Where the draft lives, when the host keeps it; defaults to this layer. */
  draft?: [
    get: Accessor<CommentDraft | undefined>,
    set: (draft: CommentDraft | undefined) => void,
  ];
  /** Whether the reviewer can start a comment; defaults to always. */
  canComment?: Accessor<boolean>;
  render: (spot: CommentSpot<T>) => JSX.Element;
}): DiffComments {
  const [ownDraft, setOwnDraft] = createSignal<CommentDraft>();
  const [draft, setDraft] = options.draft ?? [ownDraft, setOwnDraft];
  // A focused editor that is removed on post or cancel sends no focusout, so
  // focus taken while drafting only counts while that draft still exists.
  const [focused, setFocused] = createSignal<{
    range: LineRange;
    whileDrafting: boolean;
  }>();

  const itemsAt = (path: string, key: string) =>
    options
      .items()
      .filter((item) => {
        const range = options.rangeOf(item);
        return range.path === path && spotKey(range) === key;
      })
      .sort(
        (a, b) => options.rangeOf(a).lineNumber - options.rangeOf(b).lineNumber
      );
  const draftAt = (path: string, key: string) => {
    const current = draft();
    return current?.range.path === path && spotKey(current.range) === key
      ? current
      : undefined;
  };
  const rangeAt = (path: string, key: string) => {
    const first = itemsAt(path, key)[0];
    return draftAt(path, key)?.range ?? (first && options.rangeOf(first));
  };

  const startDraft = (range: LineRange) => setDraft({ range, text: '' });

  return {
    annotations: (entry) => {
      const spots = new Map<string, LineAnnotation>();
      const ranges = options
        .items()
        .map(options.rangeOf)
        .concat(draft()?.range ?? []);
      for (const range of ranges) {
        if (range.path !== entry.file.path) continue;
        const key = spotKey(range);
        spots.set(key, {
          key,
          side: range.side,
          lineNumber: range.endLineNumber,
        });
      }
      return [...spots.values()];
    },
    renderAnnotation: (entry, key) => {
      const path = entry.file.path;
      return (
        <div
          class="font-sans"
          onFocusIn={() => {
            const range = rangeAt(path, key);
            setFocused(
              range
                ? { range, whileDrafting: draft() !== undefined }
                : undefined
            );
          }}
          onFocusOut={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node && event.currentTarget.contains(next))) {
              setFocused(undefined);
            }
          }}
        >
          {options.render({
            path,
            get items() {
              return itemsAt(path, key);
            },
            get draft() {
              return draftAt(path, key);
            },
          })}
        </div>
      );
    },
    selection: () => {
      const current = focused();
      const writing = draft();
      if (current && (!current.whileDrafting || writing)) return current.range;
      return writing?.range;
    },
    get onSelectLines() {
      return options.canComment?.() === false ? undefined : startDraft;
    },
    draft,
    startDraft,
    editDraft: (text) => {
      const current = draft();
      if (current) setDraft({ ...current, text });
    },
    cancelDraft: () => setDraft(undefined),
  };
}
