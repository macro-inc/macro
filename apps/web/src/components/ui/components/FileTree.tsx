/**
 * Items shown as a tree of paths, with rows sized and coloured like the
 * workspace sidebar's trees (Drive's folders, the tag tree): 32px rows, a
 * leading icon slot, a disclosure button on the right rail, and a guide line
 * under each open directory, which opens and closes with the same
 * `CollapseTransition`. The root owns open directories and the selection;
 * the host decides what each file row shows.
 *
 * Rows are ordinary buttons, reached with Tab like the sidebar trees. The
 * arrow keys also move between rows, and Left/Right close and open a
 * directory.
 */

import CaretDownIcon from '@phosphor/caret-down.svg';
import FolderIcon from '@phosphor/folder.svg';
import FolderOpenIcon from '@phosphor/folder-open.svg';
import {
  createContext,
  createMemo,
  createSignal,
  For,
  type JSX,
  splitProps,
  useContext,
} from 'solid-js';
import { cn } from '../utils/classname';
import {
  buildFileTree,
  type FileTreeDirectory,
  type FileTreeFile,
  type FileTreeNode,
  visibleNodes,
} from '../utils/file-tree';
import { Button } from './Button';
import { CollapseTransition } from './CollapseTransition';

const NodeContext = createContext<FileTreeNode<unknown>>();

/** The leading glyph slot, so every row's name starts on the same line. */
function Icon(props: { children: JSX.Element; class?: string }) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'flex size-5 shrink-0 items-center justify-center [&>svg]:size-4',
        props.class
      )}
    >
      {props.children}
    </span>
  );
}

/** The current row's name: a file's basename, or a directory's segment. */
function Name(props: { class?: string }) {
  const node = useContext(NodeContext);
  if (!node) throw new Error('FileTree.Name must be inside a FileTree row');
  return (
    <span class={cn('min-w-0 flex-1 truncate', props.class)}>{node.name}</span>
  );
}

function Row(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
) {
  const [local, rest] = splitProps(props, ['active', 'class']);
  return (
    <button
      type="button"
      {...rest}
      class={cn(
        'flex h-8 w-full min-w-0 shrink-0 items-center justify-start gap-1.5 rounded-lg px-2 text-left text-sm leading-5 outline-none focus-visible:outline-2 focus-visible:outline-accent touch:h-11',
        local.active
          ? 'bg-active text-ink'
          : 'text-ink-muted hover:bg-hover hover:text-ink',
        local.class
      )}
    />
  );
}

type FileTreeRootProps<T> = {
  items: readonly T[];
  path: (item: T) => string;
  /** The selected file, by path. */
  selected?: string;
  onSelect?: (item: T) => void;
  /** What a file's row shows; lead with `FileTree.Icon`, then `FileTree.Name`. */
  children: (file: FileTreeFile<T>) => JSX.Element;
  /** What a directory's row shows; defaults to a folder and its name. */
  directory?: (directory: FileTreeDirectory<T>) => JSX.Element;
  'aria-label': string;
  class?: string;
};

function Root<T>(props: FileTreeRootProps<T>) {
  const nodes = createMemo(() => buildFileTree(props.items, props.path));
  const [closed, setClosed] = createSignal<ReadonlySet<string>>(new Set());
  const isOpen = (path: string) => !closed().has(path);
  const setOpen = (path: string, open: boolean) =>
    setClosed((previous) => {
      if (previous.has(path) !== open) return previous;
      const next = new Set(previous);
      if (open) next.delete(path);
      else next.add(path);
      return next;
    });
  const toggle = (path: string) => setOpen(path, !isOpen(path));
  const rows = createMemo(() => visibleNodes(nodes(), isOpen));

  let container!: HTMLDivElement;
  const focusRow = (path: string) => {
    const rowElements = container.querySelectorAll<HTMLElement>(
      '[data-file-tree-path]'
    );
    for (const row of rowElements) {
      if (row.dataset.fileTreePath === path) {
        return row.querySelector<HTMLElement>('button')?.focus();
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const path = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-file-tree-path]'
    )?.dataset.fileTreePath;
    const visible = rows();
    const index = visible.findIndex((row) => row.node.path === path);
    const row = visible[index];
    if (!row) return;
    const moveTo = (to: string | undefined) => {
      if (to === undefined) return;
      event.preventDefault();
      focusRow(to);
    };
    const node = row.node;
    const directoryOpen = node.kind === 'directory' && isOpen(node.path);
    switch (event.key) {
      case 'ArrowDown':
        return moveTo(visible[index + 1]?.node.path);
      case 'ArrowUp':
        return moveTo(visible[index - 1]?.node.path);
      case 'ArrowRight':
        if (node.kind !== 'directory') return;
        event.preventDefault();
        if (directoryOpen) moveTo(node.children[0]?.path);
        else setOpen(node.path, true);
        return;
      case 'ArrowLeft':
        if (directoryOpen) {
          event.preventDefault();
          setOpen(node.path, false);
        } else {
          moveTo(row.parent);
        }
        return;
    }
  };

  const DirectoryRow = (row: { directory: FileTreeDirectory<T> }) => {
    const path = () => row.directory.path;
    const open = () => isOpen(path());
    return (
      <li class="min-w-0" data-file-tree-path={path()}>
        <NodeContext.Provider value={row.directory}>
          <div class="relative min-w-0">
            <Row class="pr-9" title={path()} onClick={() => toggle(path())}>
              {props.directory ? (
                props.directory(row.directory)
              ) : (
                <>
                  <Icon>{open() ? <FolderOpenIcon /> : <FolderIcon />}</Icon>
                  <Name />
                </>
              )}
            </Row>
            <span class="absolute top-1/2 right-1.5 flex -translate-y-1/2">
              <Button
                variant="ghost"
                size="icon-sm"
                class="size-6 shrink-0 rounded-lg touch:size-9"
                label={`${open() ? 'Collapse' : 'Expand'} ${row.directory.name}`}
                aria-expanded={open()}
                onClick={() => toggle(path())}
              >
                <CaretDownIcon
                  class={cn(
                    'size-3 -rotate-90 transition-transform',
                    open() && 'rotate-0'
                  )}
                />
              </Button>
            </span>
          </div>
        </NodeContext.Provider>
        <CollapseTransition open={open()}>
          <div class="relative min-w-0 pl-5 before:pointer-events-none before:absolute before:inset-y-0 before:left-4.5 before:w-px before:-translate-x-1/2 before:bg-edge-divider">
            <Nodes nodes={row.directory.children} />
          </div>
        </CollapseTransition>
      </li>
    );
  };

  const FileRow = (row: { file: FileTreeFile<T> }) => {
    const selected = () => props.selected === row.file.path;
    return (
      <li class="min-w-0" data-file-tree-path={row.file.path}>
        <NodeContext.Provider value={row.file}>
          <Row
            active={selected()}
            aria-current={selected() ? 'true' : undefined}
            title={row.file.path}
            onClick={() => props.onSelect?.(row.file.item)}
          >
            {props.children(row.file)}
          </Row>
        </NodeContext.Provider>
      </li>
    );
  };

  const Nodes = (level: { nodes: FileTreeNode<T>[] }) => (
    <ul class="flex min-w-0 flex-col gap-0.5">
      <For each={level.nodes}>
        {(node) =>
          node.kind === 'directory' ? (
            <DirectoryRow directory={node} />
          ) : (
            <FileRow file={node} />
          )
        }
      </For>
    </ul>
  );

  return (
    <div
      ref={container}
      class={cn('min-w-0', props.class)}
      role="group"
      aria-label={props['aria-label']}
      onKeyDown={onKeyDown}
    >
      <Nodes nodes={nodes()} />
    </div>
  );
}

/**
 * A tree of any items by path, for changed files, attachments, or a repository.
 * @do Give `Root` the items and a `path` accessor; it builds the tree and
 *   compresses single-child directories itself.
 * @do Lead each file row with `FileTree.Icon`, then `FileTree.Name`, so names
 *   line up with directory rows.
 * @do Put trailing content (counts, badges, status) after `FileTree.Name`; the
 *   name takes the remaining width and truncates.
 * @do Pass `directory` to change what a directory row shows after its folder.
 * @dont Do not put buttons inside a row; the row is already a button.
 * @dont Do not restyle row heights or insets at the call site; rows share the
 *   workspace sidebar's tree geometry so trees look alike across panes.
 */
export const FileTree = { Root, Icon, Name };
