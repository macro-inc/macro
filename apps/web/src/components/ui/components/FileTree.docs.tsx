import { defineDoc } from '@app/features/ui-gallery/types';
import FileIcon from '@phosphor/file.svg';
import FileCodeIcon from '@phosphor/file-code.svg';
import FileTextIcon from '@phosphor/file-text.svg';
import FolderIcon from '@phosphor/folder.svg';
import { createSignal, type JSX } from 'solid-js';
import type { FileTreeDirectory, FileTreeNode } from '../utils/file-tree';
import { FileTree } from './FileTree';

type ExampleFile = { path: string; bytes: number; owner?: string };

const REPOSITORY: ExampleFile[] = [
  { path: 'apps/web/src/features/inbox/InboxView.tsx', bytes: 8200 },
  { path: 'apps/web/src/features/inbox/inbox-query.ts', bytes: 2100 },
  { path: 'apps/web/src/features/inbox/README.md', bytes: 900 },
  { path: 'apps/web/src/lib/core/util/url.ts', bytes: 1300, owner: 'core' },
  { path: 'crates/macro_inbox/src/lib.rs', bytes: 4100, owner: 'backend' },
  {
    path: 'crates/macro_inbox/src/outbound/postgres.rs',
    bytes: 6400,
    owner: 'backend',
  },
  { path: 'crates/macro_inbox/Cargo.toml', bytes: 700, owner: 'backend' },
  { path: 'docs/STYLE_GUIDE.md', bytes: 15_000 },
  { path: 'justfile', bytes: 2600 },
  { path: 'README.md', bytes: 3100 },
];

function FileGlyph(props: { path: string }) {
  if (/\.(tsx?|rs)$/.test(props.path)) return <FileCodeIcon />;
  if (/\.md$/.test(props.path)) return <FileTextIcon />;
  return <FileIcon />;
}

/** A sidebar-sized frame with the selection read back below the tree. */
function Frame(props: {
  files: ExampleFile[];
  row?: (file: ExampleFile) => JSX.Element;
  directory?: (directory: FileTreeDirectory<ExampleFile>) => JSX.Element;
}) {
  const [selected, setSelected] = createSignal<string>();
  return (
    <div class="flex w-80 flex-col overflow-hidden rounded-lg border border-edge bg-panel">
      <FileTree.Root
        aria-label="Example files"
        class="max-h-96 overflow-y-auto p-2"
        items={props.files}
        path={(file) => file.path}
        selected={selected()}
        onSelect={(file) => setSelected(file.path)}
        directory={props.directory}
      >
        {(node) => (
          <>
            <FileTree.Icon>
              <FileGlyph path={node.path} />
            </FileTree.Icon>
            <FileTree.Name />
            {props.row?.(node.item)}
          </>
        )}
      </FileTree.Root>
      <p class="truncate border-t border-edge-muted px-3 py-1.5 text-xs text-ink-subtle">
        {selected() ?? 'Click a file, or use the arrow keys'}
      </p>
    </div>
  );
}

// #region demo:basic
function BasicDemo() {
  return <Frame files={REPOSITORY} />;
}
// #endregion

// #region demo:trailing
function TrailingDemo() {
  const size = (bytes: number) =>
    bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(1)} kB`;
  return (
    <Frame
      files={REPOSITORY}
      row={(file) => (
        <span class="shrink-0 text-xs tabular-nums text-ink-placeholder">
          {size(file.bytes)}
        </span>
      )}
    />
  );
}
// #endregion

// #region demo:directories
function DirectoriesDemo() {
  const countFiles = (node: FileTreeNode<ExampleFile>): number =>
    node.kind === 'file'
      ? 1
      : node.children.reduce((sum, child) => sum + countFiles(child), 0);
  return (
    <Frame
      files={REPOSITORY}
      row={(file) =>
        file.owner ? (
          <span class="shrink-0 rounded-full border border-edge-muted px-1.5 text-xs text-ink-subtle">
            {file.owner}
          </span>
        ) : undefined
      }
      directory={(directory) => (
        <>
          <FileTree.Icon>
            <FolderIcon />
          </FileTree.Icon>
          <FileTree.Name />
          <span class="shrink-0 text-xs tabular-nums text-ink-placeholder">
            {countFiles(directory)}
          </span>
        </>
      )}
    />
  );
}
// #endregion

// #region demo:compressed
function CompressedDemo() {
  return (
    <Frame
      files={[
        { path: 'a/b/c/d/e/f/only-child.ts', bytes: 100 },
        { path: 'a/b/c/d/sibling.ts', bytes: 100 },
        { path: 'x/y/z/far/away/file.ts', bytes: 100 },
        { path: 'x/y/near.ts', bytes: 100 },
      ]}
    />
  );
}
// #endregion

// #region demo:large
function LargeDemo() {
  const areas = ['apps/web/src/features', 'crates', 'packages', 'services'];
  const files = Array.from({ length: 600 }, (_, index) => ({
    path: `${areas[index % areas.length]}/module_${Math.floor(index / 12) % 25}/part_${index % 3}/file_${index}.ts`,
    bytes: 200 + ((index * 97) % 9000),
  }));
  return <Frame files={files} />;
}
// #endregion

export default defineDoc({
  name: 'FileTree',
  category: 'Navigation',
  status: 'beta',
  description:
    'Items shown as a tree of paths. The root builds the tree, compresses single-child directories, and owns open directories, the selection, and the arrow keys; the host renders each file row.',
  exports: ['FileTree'],
  import: "import { FileTree } from '@ui/components/FileTree';",
  propTypes: ['FileTreeRootProps'],
  demos: [
    { id: 'basic', title: 'Names and file icons', render: BasicDemo },
    {
      id: 'trailing',
      title: 'Trailing content',
      description: 'Anything after `FileTree.Name` sits at the row end.',
      render: TrailingDemo,
    },
    {
      id: 'directories',
      title: 'Custom directory rows',
      render: DirectoriesDemo,
    },
    {
      id: 'compressed',
      title: 'Compressed single-child chains',
      render: CompressedDemo,
    },
    { id: 'large', title: '600 files', render: LargeDemo },
  ],
});
