# Diff view

File diffs from one unified patch, drawn with Pierre. `DiffView.Root` pairs the
host's `files` with the `patch`, and holds the diff style, collapse state, and
the file to scroll to (`active`). A list renderer draws the files:
`DiffView.Stack` gives each file its own card and Pierre instance.

Patch parsing runs through the shared render queue after the pane shell mounts.
Unchanged patch invalidations keep parsed entries and Pierre instances intact,
including when a host switches between split and full-width layouts.
`Stack` keeps lightweight file headers and defers expanded diff bodies until their
cards approach the scroll viewport. The render queue yields between file bodies;
selecting a file also schedules its body, even outside the viewport. Once a body
loads, it stays mounted until collapsed or the stack closes.
Selecting a file keeps its header aligned while queued diffs or asynchronous
highlighting change earlier card heights. Wheel, pointer, and keyboard interaction
release the anchor so manual scrolling and review-note editing remain unrestricted.
Refreshing files or patch text does not reselect an unchanged active file after
that release; an initial pending selection still waits for its file card.

`Root` keeps patch parsing separate from the stack's body-reveal queue.
`create-diff-reveal.ts` owns viewport observation and file-card registration;
scroll anchoring stays in `Stack` and also reacts to later highlighting.
Both queues are scoped to their respective Solid owners. A host that animates
an exit retains those owners until the visual exit completes.

Each file is an outlined `@ui` `Card` with a 40px sticky header: a ghost
disclosure button, the status letter and `text-xs` path (directory in
`text-ink-subtle`), and `text-xs` counts. Both default and custom headers use
an opaque `bg-surface` with `hover:overlay-hover`, so diff text never shows through
the sticky row on hover. Hovering the header highlights the row but does not toggle
it; only the disclosure and path controls toggle collapse. Toolbar parts use
standard `Button` and `SegmentedControl` sizes, and backgrounds come from the
card's depth.

The host composes the rest:

- Each file's sticky header, from `DiffView.CollapseButton`, `DiffView.FilePath`,
  `DiffView.FileCounts`, and its own actions. The default header is the first three.
- Content under lines (`annotations`, `renderAnnotation`), and the gutter **+**
  for picking lines (`onSelectLines`). `selection` lights one range per file:
  the range being annotated, or one the host points at, such as a focused
  comment's. Omit these for a read-only diff.
- Toolbar parts, `DiffView.CollapseAll` and `DiffView.StyleToggle`, anywhere
  inside `Root`.
- Collapse state that persists, by passing `collapse`; the default lives in memory.
- `DiffCounts` for compact numeric totals, or `DiffStats` for those same totals
  beside five green/red squares showing the addition/deletion proportion. A static
  diagonal hatch and inset edge give the squares texture without changing their size.
  Exact totals remain accessible without relying on color. Zero totals show neutral squares.

```tsx
<DiffView.Root files={files()} patch={patch()} diffStyle={style()} active={active()}>
  <DiffView.CollapseAll />
  <DiffView.Stack
    header={(entry) => (
      <>
        <DiffView.CollapseButton />
        <DiffView.FilePath />
        <CopyPathButton path={entry.file.path} />
      </>
    )}
  />
</DiffView.Root>
```

## Comments under lines

`createDiffComments` turns a host's items into the four annotation props above.
It hangs each item under the last line of its `LineRange` (grouping items that
end on the same line, like a GitHub thread), holds the one comment being
written, and lights the lines of the thread with focus. The host renders each
line's `CommentSpot`, its items and the draft when it is there; `CommentThread`
has the parts for GitHub-style threads (`Root`, `Comment`, `Reply`, and a
controlled `Composer`). Agent review notes render their own `NoteAnnotation`
through the same layer.

```tsx
const comments = createDiffComments({
  items: threads,
  rangeOf: (thread) => thread.range,
  render: (spot) => <ReviewThread spot={spot} comments={comments} />,
});
<DiffView.Stack
  annotations={comments.annotations}
  renderAnnotation={comments.renderAnnotation}
  selection={comments.selection}
  onSelectLines={comments.onSelectLines}
/>;
```

A `LineRange` ends on `side`. A unified range dragged from deleted lines into
added ones also has `startSide`, and each end is in its own side's numbering,
which is GitHub's `start_side` model.

Pierre decides where annotation rows go: under a line on one side, or above the
first hunk for line 0. Their content is ours and renders in the light DOM, where
it would inherit Pierre's mono font; the layer sets `font-sans`. The row itself
is drawn in Pierre's shadow root: `--diffs-annotation-min-height` can be set from
outside, but its background and padding need `unsafeCSS`, which targets Pierre's
markup and can break on an upgrade. Pierre re-creates an annotation's element
when rows before it change and on every Unified/Split switch, so the draft lives
in the layer or with the host (`draft` option), never in the rendered editor.

`pierre/theme.ts` holds the theme signal and CSS variables every Pierre diff in
the app shares, including the transcript's tool-call diffs. Examples, including
review threads and a generated changeset of up to 500 files, live at
`/debug/diff-view-ui` in local builds.
