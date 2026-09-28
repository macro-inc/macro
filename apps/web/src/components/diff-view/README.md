# Diff view

File diffs from one unified patch, drawn with Pierre. `DiffView.Root` pairs the
host's `files` with the `patch`, and holds the diff style, collapse state, and
the file to scroll to (`active`). A list renderer draws the files:
`DiffView.Stack` gives each file its own card and Pierre instance.

Each file is an outlined `@ui` `Card` with a 40px sticky header: a ghost
disclosure button, the status letter and `text-xs` path (directory in
`text-ink-subtle`), and `text-xs` counts. Toolbar parts use standard `Button`
and `SegmentedControl` sizes, and backgrounds come from the card's depth.

The host composes the rest:

- Each file's sticky header, from `DiffView.CollapseButton`, `DiffView.FilePath`,
  `DiffView.FileCounts`, and its own actions. The default header is the first three.
- Content under lines (`annotations`, `renderAnnotation`), and the gutter **+**
  for picking lines (`onSelectLines`). `selection` lights one range per file:
  the range being annotated, or one the host points at, such as a focused
  comment's. Omit these for a read-only diff.
- A column beside each file's diff (`aside`), for content the host places
  itself, such as margin comments.

Pierre decides where annotation rows go: under a line on one side, or above
the first hunk for line 0. Their content is ours and renders in the light DOM,
so it inherits Pierre's mono font unless it sets `font-sans`. The row itself is
drawn in Pierre's shadow root: `--diffs-annotation-min-height` can be set from
outside, but its background and padding need `unsafeCSS`, which targets
Pierre's markup and can break on an upgrade. Pierre re-creates an annotation's
element when rows before it change and on every Unified/Split switch, so keep
state such as draft text in the host, not in the rendered component. The
gallery's comment prototypes (`debug/CommentPrototypes.tsx`) show both inline
threads and margin placement, where the margin measures zero-height anchors
Pierre keeps under each commented line.
- Toolbar parts, `DiffView.CollapseAll` and `DiffView.StyleToggle`, anywhere
  inside `Root`.
- Collapse state that persists, by passing `collapse`; the default lives in memory.

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

`pierre/theme.ts` holds the theme signal and CSS variables every Pierre diff in
the app shares, including the transcript's tool-call diffs. Examples, including
a generated changeset of up to 500 files, live at `/debug/diff-view-ui` in local
builds.
