/**
 * Debug gallery for the file tree: the same root with different row content,
 * over example paths. Registered as the `file-tree-ui` component.
 */

import FileIcon from '@phosphor/file.svg';
import FileCodeIcon from '@phosphor/file-code.svg';
import FileTextIcon from '@phosphor/file-text.svg';
import FolderIcon from '@phosphor/folder.svg';
import { createSignal, type JSX } from 'solid-js';
import type { FileTreeDirectory, FileTreeNode } from '../build-file-tree';
import { FileTree } from '../FileTree';

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

const DEEP: ExampleFile[] = [
  { path: 'a/b/c/d/e/f/only-child.ts', bytes: 100 },
  { path: 'a/b/c/d/sibling.ts', bytes: 100 },
  { path: 'x/y/z/far/away/file.ts', bytes: 100 },
  { path: 'x/y/near.ts', bytes: 100 },
];

function generatedFiles(count: number): ExampleFile[] {
  const areas = ['apps/web/src/features', 'crates', 'packages', 'services'];
  return Array.from({ length: count }, (_, index) => {
    const area = areas[index % areas.length]!;
    const group = `module_${Math.floor(index / 12) % 25}`;
    return {
      path: `${area}/${group}/part_${index % 3}/file_${index}.ts`,
      bytes: 200 + ((index * 97) % 9000),
    };
  });
}

function FileGlyph(props: { path: string }) {
  if (/\.(tsx?|rs)$/.test(props.path)) return <FileCodeIcon />;
  if (/\.md$/.test(props.path)) return <FileTextIcon />;
  return <FileIcon />;
}

function formatBytes(bytes: number): string {
  return bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(1)} kB`;
}

function countFiles(node: FileTreeNode<ExampleFile>): number {
  return node.kind === 'file'
    ? 1
    : node.children.reduce((sum, child) => sum + countFiles(child), 0);
}

function Item(props: { label: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-2">
      <h2 class="text-xs font-medium uppercase tracking-wide text-ink-extra-muted">
        {props.label}
      </h2>
      <div class="flex flex-col gap-2">{props.children}</div>
    </section>
  );
}

/** One tree in a sidebar-sized frame, with the selection read back below it. */
function Demo(props: {
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

export default function FileTreeGallery() {
  return (
    <div class="size-full overflow-auto">
      <div class="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-8">
        <Item label="Names only">
          <Demo files={REPOSITORY} />
        </Item>
        <Item label="Rows with trailing content">
          <Demo
            files={REPOSITORY}
            row={(file) => (
              <span class="shrink-0 text-xs tabular-nums text-ink-placeholder">
                {formatBytes(file.bytes)}
              </span>
            )}
          />
        </Item>
        <Item label="Custom directory rows">
          <Demo
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
        </Item>
        <Item label="Compressed single-child chains">
          <Demo files={DEEP} />
        </Item>
        <Item label="Large tree (600 files)">
          <Demo files={generatedFiles(600)} />
        </Item>
      </div>
    </div>
  );
}
