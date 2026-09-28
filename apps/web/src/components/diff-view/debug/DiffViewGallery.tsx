/**
 * Debug gallery for the diff view: the parts composed the ways hosts compose
 * them, over example changes. Registered as the `diff-view-ui` component.
 */

import CopyIcon from '@phosphor/copy.svg';
import FileIcon from '@phosphor/file.svg';
import { Button, SegmentedControl } from '@ui';
import { FileTree } from '@ui/components/FileTree';
import { createMemo, createSignal, type JSX, Show } from 'solid-js';
import { DiffCounts } from '../DiffCounts';
import { DiffView } from '../DiffView';
import type { DiffFile, DiffStyle } from '../model/diff-file';
import { StatusLetter } from '../StatusLetter';
import { CommentsDemo } from './CommentsDemo';
import { generatedChanges, SAMPLE_FILES, SAMPLE_PATCH } from './fixtures';

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

function Frame(props: { children: JSX.Element }) {
  return (
    <div class="flex h-[520px] min-h-0 flex-col overflow-hidden rounded-lg border border-edge bg-panel">
      {props.children}
    </div>
  );
}

/** A file tree beside the stack, with the toolbar a pane would show. */
function ComposedDemo(props: { files: DiffFile[]; patch: string }) {
  const [style, setStyle] = createSignal<DiffStyle>('unified');
  const [active, setActive] = createSignal<string>();
  const reveal = (path: string) => {
    // Re-selecting the same file must still scroll, so clear first.
    setActive(undefined);
    setActive(path);
  };
  return (
    <Frame>
      <DiffView.Root
        files={props.files}
        patch={props.patch}
        diffStyle={style()}
        active={active()}
      >
        <div class="flex h-10 shrink-0 items-center gap-2 border-b border-edge-muted px-3">
          <span class="flex-1 text-xs text-ink-subtle">
            {props.files.length} files
          </span>
          <DiffView.StyleToggle value={style()} onChange={setStyle} />
          <DiffView.CollapseAll />
        </div>
        <div class="flex min-h-0 flex-1">
          <FileTree.Root
            aria-label="Changed files"
            class="w-64 shrink-0 overflow-y-auto border-r border-edge-muted p-2"
            items={props.files}
            path={(file) => file.path}
            selected={active()}
            onSelect={(file) => reveal(file.path)}
          >
            {(node) => (
              <>
                <FileTree.Icon>
                  <FileIcon />
                </FileTree.Icon>
                <FileTree.Name />
                <span class="shrink-0 text-xs">
                  <DiffCounts
                    additions={node.item.additions}
                    deletions={node.item.deletions}
                  />
                </span>
                <StatusLetter kind={node.item.kind} />
              </>
            )}
          </FileTree.Root>
          <DiffView.Stack />
        </div>
      </DiffView.Root>
    </Frame>
  );
}

/** A header with a host action after the default parts. */
function CustomHeaderDemo() {
  const [copied, setCopied] = createSignal<string>();
  return (
    <Frame>
      <DiffView.Root
        files={SAMPLE_FILES.slice(1, 3)}
        patch={SAMPLE_PATCH}
        diffStyle="split"
      >
        <DiffView.Stack
          header={(entry) => (
            <>
              <DiffView.CollapseButton />
              <DiffView.FilePath />
              <DiffView.FileCounts />
              <Button
                variant="ghost"
                size="icon-sm"
                tooltip="Copy path"
                onClick={() => setCopied(entry.file.path)}
              >
                <CopyIcon />
              </Button>
            </>
          )}
        />
      </DiffView.Root>
      <p class="shrink-0 border-t border-edge-muted px-3 py-1.5 text-xs text-ink-subtle">
        {copied() ? `Copied ${copied()}` : 'Copy a path from a header'}
      </p>
    </Frame>
  );
}

/** Pick a size and scroll; the stack mounts one Pierre instance per file. */
function LargeChangesetDemo() {
  const [count, setCount] = createSignal('200');
  const changes = createMemo(() => generatedChanges(Number(count())));
  return (
    <>
      <SegmentedControl
        size="sm"
        aria-label="Files"
        value={count()}
        options={[
          { value: '50', label: '50 files' },
          { value: '200', label: '200 files' },
          { value: '500', label: '500 files' },
        ]}
        onChange={setCount}
        class="self-start"
      />
      <Show when={changes()} keyed>
        {(current) => (
          <ComposedDemo files={current.files} patch={current.patch} />
        )}
      </Show>
    </>
  );
}

export default function DiffViewGallery() {
  return (
    <div class="size-full overflow-auto">
      <div class="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-8">
        <Item label="Composed: file tree, toolbar, and stack">
          <ComposedDemo files={SAMPLE_FILES} patch={SAMPLE_PATCH} />
        </Item>
        <Item label="Custom header (split style)">
          <CustomHeaderDemo />
        </Item>
        <Item label="Review threads under their lines">
          <CommentsDemo />
        </Item>
        <Item label="Files without diff text">
          <Frame>
            <DiffView.Root
              files={SAMPLE_FILES.slice(-2)}
              patch=""
              diffStyle="unified"
            >
              <DiffView.Stack />
            </DiffView.Root>
          </Frame>
        </Item>
        <Item label="Large changeset">
          <LargeChangesetDemo />
        </Item>
      </div>
    </div>
  );
}
