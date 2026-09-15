import { DiffChanges } from '@app/features/block-agent/ui/DiffChanges';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import { cn } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { describeFileCount } from '../core/changeset';
import type { FileTreeDir, FileTreeNode } from '../core/file-tree';
import { StatusLetter } from './StatusLetter';

export type FileTreeProps = {
  nodes: FileTreeNode[];
  fileCount: number;
  viewed: ReadonlySet<string>;
  active: string | undefined;
  onSelect: (path: string) => void;
};

function DirRow(props: {
  dir: FileTreeDir;
  viewed: ReadonlySet<string>;
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
            viewed={props.viewed}
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
  viewed: ReadonlySet<string>;
  active: string | undefined;
  onSelect: (path: string) => void;
}) {
  return (
    <For each={props.nodes}>
      {(node) =>
        node.kind === 'dir' ? (
          <DirRow
            dir={node}
            viewed={props.viewed}
            active={props.active}
            onSelect={props.onSelect}
          />
        ) : (
          <button
            type="button"
            class={cn(
              'flex min-h-6 w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs text-ink-muted hover:bg-hover',
              props.active === node.file.path && 'bg-selected text-ink',
              props.viewed.has(node.file.path) && 'text-ink-disabled'
            )}
            aria-current={props.active === node.file.path ? 'true' : undefined}
            title={node.file.path}
            onClick={() => props.onSelect(node.file.path)}
          >
            <StatusLetter kind={node.file.kind} />
            <span class="min-w-0 flex-1 truncate font-mono text-[11.5px]">
              {node.name}
            </span>
            <Show
              when={!props.viewed.has(node.file.path)}
              fallback={
                <CheckIcon
                  class="size-3 shrink-0 text-ink-disabled"
                  aria-label="Viewed"
                />
              }
            >
              <DiffChanges
                variant="bars"
                additions={node.file.additions}
                deletions={node.file.deletions}
              />
            </Show>
          </button>
        )
      }
    </For>
  );
}

/** The changed files, grouped by compressed directory, in patch order. */
export function FileTree(props: FileTreeProps) {
  return (
    <nav
      class="flex w-58 shrink-0 flex-col gap-px overflow-y-auto border-r border-edge-muted px-1.5 pt-2 pb-4 max-md:w-44"
      aria-label="Changed files"
    >
      <div class="flex items-center gap-1.5 px-1.5 pt-0.5 pb-1.5 text-[10px] tracking-[0.07em] text-ink-placeholder uppercase">
        <span class="flex-1">{describeFileCount(props.fileCount)}</span>
      </div>
      <Rows
        nodes={props.nodes}
        viewed={props.viewed}
        active={props.active}
        onSelect={props.onSelect}
      />
    </nav>
  );
}
