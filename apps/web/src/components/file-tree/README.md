# File tree

A tree of any items by path. `FileTree.Root` builds the tree from `items` and
`path`, compresses single-child directory chains, and owns open directories and
the selection highlight. Rows copy the workspace sidebar's tree geometry (32px
rows, a leading 20px icon slot, the disclosure button on the right rail, a guide
line under open directories) without depending on `ViewSidebar`, and directories
open and close with the same `CollapseTransition` from `@ui`. Rows are
buttons; the arrow keys also move between them, and Left/Right close and open a
directory.

The host renders each file row, leading with `FileTree.Icon` so names line up:

```tsx
<FileTree.Root
  aria-label="Changed files"
  items={files()}
  path={(file) => file.path}
  selected={active()}
  onSelect={(file) => setActive(file.path)}
>
  {(node) => (
    <>
      <FileTree.Icon>
        <FileIcon />
      </FileTree.Icon>
      <FileTree.Name />
      <StatusLetter kind={node.item.kind} />
    </>
  )}
</FileTree.Root>
```

Pass `directory` to change what a directory row shows; it defaults to a folder
icon and the name. Examples live at `/debug/file-tree-ui` in local builds.
