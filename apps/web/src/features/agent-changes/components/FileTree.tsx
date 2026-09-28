import CaretRightIcon from '@phosphor/caret-right.svg';
import { cn } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { FileTreeDir, FileTreeNode } from '../core/file-tree';
import {
  clampFileTreeWidth,
  DEFAULT_FILE_TREE_WIDTH,
  MAX_FILE_TREE_WIDTH,
  MIN_FILE_TREE_WIDTH,
} from '../core/layout';
import { DiffCounts } from './DiffCounts';
import { StatusLetter } from './StatusLetter';

export type FileTreeProps = {
  nodes: FileTreeNode[];
  active: string | undefined;
  onSelect: (path: string) => void;
  /** Width in pixels. */
  width: number;
  onResize: (width: number) => void;
};

function DirRow(props: {
  dir: FileTreeDir;
  active: string | undefined;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = createSignal(true);
  return (
    <>
      <button
        type="button"
        class="flex min-h-6 w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-ink-placeholder hover:bg-hover"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        <CaretRightIcon
          class={cn(
            'size-3 shrink-0 transition-transform duration-100 motion-reduce:transition-none',
            open() && 'rotate-90'
          )}
        />
        <span class="min-w-0 flex-1 truncate font-mono text-[11px]">
          {props.dir.name}
        </span>
      </button>
      <Show when={open()}>
        <div class="ml-[7px] flex flex-col gap-px border-l border-edge-muted pl-2.5">
          <Rows
            nodes={props.dir.children}
            active={props.active}
            onSelect={props.onSelect}
          />
        </div>
      </Show>
    </>
  );
}

function Rows(props: {
  nodes: FileTreeNode[];
  active: string | undefined;
  onSelect: (path: string) => void;
}) {
  return (
    <For each={props.nodes}>
      {(node) =>
        node.kind === 'dir' ? (
          <DirRow dir={node} active={props.active} onSelect={props.onSelect} />
        ) : (
          <button
            type="button"
            class={cn(
              'flex min-h-6 w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs text-ink-muted hover:bg-hover',
              props.active === node.file.path && 'bg-selected text-ink'
            )}
            aria-current={props.active === node.file.path ? 'true' : undefined}
            title={node.file.path}
            onClick={() => props.onSelect(node.file.path)}
          >
            <StatusLetter kind={node.file.kind} />
            <span class="min-w-0 flex-1 truncate font-mono text-[11.5px]">
              {node.name}
            </span>
            <DiffCounts
              additions={node.file.additions}
              deletions={node.file.deletions}
            />
          </button>
        )
      }
    </For>
  );
}

const KEYBOARD_STEP_PX = 16;

/**
 * The divider on the tree's right edge. The width follows the pointer
 * locally and is committed once, when the drag ends.
 */
function ResizeHandle(props: {
  width: number;
  onPreview: (width: number | undefined) => void;
  onCommit: (width: number) => void;
}) {
  let drag: { startX: number; startWidth: number } | undefined;
  const widthAt = (clientX: number) =>
    clampFileTreeWidth(drag ? drag.startWidth + clientX - drag.startX : 0);
  const end = (event: PointerEvent) => {
    if (!drag) return;
    const width = widthAt(event.clientX);
    drag = undefined;
    props.onPreview(undefined);
    props.onCommit(width);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the file tree"
      aria-valuemin={MIN_FILE_TREE_WIDTH}
      aria-valuemax={MAX_FILE_TREE_WIDTH}
      aria-valuenow={props.width}
      tabindex={0}
      class="group absolute inset-y-0 -right-1 z-10 flex w-2 cursor-col-resize touch-none justify-center outline-none"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag = { startX: event.clientX, startWidth: props.width };
      }}
      onPointerMove={(event) => {
        if (drag) props.onPreview(widthAt(event.clientX));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDblClick={() => props.onCommit(DEFAULT_FILE_TREE_WIDTH)}
      onKeyDown={(event) => {
        const step =
          event.key === 'ArrowLeft'
            ? -KEYBOARD_STEP_PX
            : event.key === 'ArrowRight'
              ? KEYBOARD_STEP_PX
              : 0;
        if (!step) return;
        event.preventDefault();
        props.onCommit(clampFileTreeWidth(props.width + step));
      }}
    >
      <span class="w-px bg-transparent transition-colors group-hover:bg-edge group-focus-visible:bg-edge-focus group-active:bg-edge-focus" />
    </div>
  );
}

/** The changed files, grouped by compressed directory, in patch order. */
export function FileTree(props: FileTreeProps) {
  const [preview, setPreview] = createSignal<number>();
  const width = () => preview() ?? props.width;
  return (
    <div
      class="relative flex max-w-[45%] shrink-0 border-r border-edge-muted"
      style={{ width: `${width()}px` }}
    >
      <nav
        class="flex min-w-0 flex-1 flex-col gap-px overflow-y-auto px-1.5 pt-2 pb-4"
        aria-label="Changed files"
      >
        <Rows
          nodes={props.nodes}
          active={props.active}
          onSelect={props.onSelect}
        />
      </nav>
      <ResizeHandle
        width={width()}
        onPreview={setPreview}
        onCommit={props.onResize}
      />
    </div>
  );
}
