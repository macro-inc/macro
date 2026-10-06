import type { DiffFileKind } from '@app/components/diff-view/model/diff-file';
import { StatusLetter } from '@app/components/diff-view/StatusLetter';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import CollapseIcon from '@phosphor/arrows-in-line-vertical.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import FileIcon from '@phosphor/file-code.svg';
import FolderIcon from '@phosphor/folder.svg';
import XIcon from '@phosphor/x.svg';
import { createWritableMemo } from '@solid-primitives/memo';
import { createVirtualizer } from '@tanstack/solid-virtual';
import { Button, cn, Tabs } from '@ui';
import { createEffect, createMemo, For, on, Show } from 'solid-js';
import {
  fileTree,
  fileTreeRows,
  navigationRows,
  type TreeFile,
  walkthroughTrees,
} from '../core/file-tree';
import type {
  Chapter,
  CodeLocation,
  FileGroup,
  ReviewThread,
} from '../core/model';

import { ReviewFileGroups } from './ReviewFileGroups';

const navigationTabs = [
  'Walkthrough',
  'Full Diff',
  'Threads',
  'History',
] as const;
export type NavigationTab = (typeof navigationTabs)[number];

export function ReviewNavigation(props: {
  tab: NavigationTab;
  onTab: (tab: NavigationTab) => void;
  chapters: Chapter[];
  chapter: number;
  onChapter: (index: number) => void;
  files: TreeFile[];
  walkthroughFiles?: TreeFile[];
  fileGroups?: FileGroup[];
  onToggleGroup?: (key: string) => void;
  activePath: string;
  onFile: (path: string, chapter?: number) => void;
  threads: ReviewThread[];
  onLocation: (location: CodeLocation) => void;
  onThread?: (thread: ReviewThread) => void;
  revision: number;
  latestRevision: number;
  onRevision: (revision: number) => void;
  onClose?: () => void;
  active?: boolean;
}) {
  const activeChapter = createMemo(() => props.chapter);
  const [disclosures, setDisclosures] = createWritableMemo<
    ReadonlyMap<string, boolean>
  >(
    on(
      activeChapter,
      (
        chapter,
        _previousChapter,
        previous: ReadonlyMap<string, boolean> | undefined
      ) =>
        previous && props.activePath
          ? new Map(previous).set(
              chapter >= 0 ? `chapter:${chapter}` : 'other',
              true
            )
          : (previous ?? new Map())
    )
  );
  let scroller!: HTMLDivElement;
  const groups = createMemo(() =>
    walkthroughTrees(props.chapters, props.walkthroughFiles ?? props.files)
  );
  const fullTree = createMemo(() => fileTree(props.files));
  const fullRows = createMemo(() => fileTreeRows(fullTree(), new Set()));
  const isFileTab = () =>
    props.tab === 'Walkthrough' || props.tab === 'Full Diff';
  const collapsed = createMemo(() => {
    // Chapter trees start closed, including chapters arriving after the first
    // query. Folder choices and chapter choices survive metadata refreshes.
    const keys = new Set(groups().map((group) => group.key));
    for (const [key, open] of disclosures()) {
      if (open) keys.delete(key);
      else keys.add(key);
    }
    return keys;
  });
  const toggle = (key: string) =>
    setDisclosures((previous) =>
      new Map(previous).set(key, collapsed().has(key))
    );
  const rows = createMemo(() =>
    props.tab === 'Full Diff'
      ? fileTreeRows(fullTree(), collapsed())
      : navigationRows(groups(), collapsed())
  );
  const savedScroll: Partial<Record<NavigationTab, number>> = {};
  const virtualizer = createVirtualizer({
    get enabled() {
      return props.active !== false && isFileTab();
    },
    initialOffset: () => savedScroll[props.tab] ?? 0,
    get count() {
      return rows().length;
    },
    getScrollElement: () => scroller,
    estimateSize: (index) => {
      const row = rows()[index];
      if (row?.kind !== 'chapter') return 24;
      return row.chapter !== undefined &&
        props.chapters[row.chapter]?.description
        ? 112
        : 36;
    },
    getItemKey: (index) => rows()[index]?.key ?? index,
    overscan: 12,
  });
  const changeTab = (tab: NavigationTab) => {
    if (props.tab === tab) return;
    savedScroll[props.tab] = scroller.scrollTop;
    const offset = savedScroll[tab] ?? 0;
    props.onTab(tab);
    // Tab contents share a scroll element; restore each view after its DOM updates.
    queueMicrotask(() => {
      scroller.scrollTop = offset;
    });
  };
  return (
    <aside
      class="flex h-full min-h-0 w-full shrink-0 flex-col border-r border-edge-muted bg-panel @min-[800px]/review:w-[264px]"
      aria-label="Review navigation"
    >
      <Show when={props.onClose}>
        <div class="flex items-center justify-between border-b border-edge-muted px-4 py-2 @min-[800px]/review:hidden">
          <span class="text-xs font-medium">Review navigation</span>
          <Button
            size="icon-sm"
            label="Close review navigation"
            variant="ghost"
            onClick={props.onClose}
          >
            <XIcon />
          </Button>
        </div>
      </Show>
      <div class="flex items-center gap-1 border-b border-edge-muted px-2 py-2">
        <Tabs
          aria-label="Review sections"
          list={navigationTabs.map((value) => ({
            value,
            label: value,
          }))}
          value={props.tab}
          onChange={(value) => {
            const tab = navigationTabs.find((tab) => tab === value);
            if (tab) changeTab(tab);
          }}
          class="min-w-0 flex-1"
          fullWidth
          itemClass="flex-auto"
          labelClass="whitespace-nowrap px-1.5 text-[11px]"
        />
      </div>
      <Show when={isFileTab()}>
        <div class="flex h-8 shrink-0 items-center justify-between px-4 text-[11px] text-ink-subtle">
          <span>
            {(props.tab === 'Full Diff'
              ? props.files
              : (props.walkthroughFiles ?? props.files)
            ).length.toLocaleString()}{' '}
            files
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            label="Collapse all"
            onClick={() =>
              setDisclosures((previous) => {
                const next = new Map(previous);
                const all =
                  props.tab === 'Full Diff'
                    ? fullRows()
                    : navigationRows(groups(), new Set());
                for (const row of all) {
                  if (row.kind !== 'file') next.set(row.key, false);
                }
                return next;
              })
            }
          >
            <CollapseIcon />
          </Button>
        </div>
      </Show>
      <Show when={props.tab === 'Walkthrough'}>
        <ReviewFileGroups
          groups={props.fileGroups ?? []}
          onToggle={(key) => props.onToggleGroup?.(key)}
        />
      </Show>
      <div
        ref={scroller}
        data-review-navigation-scroll
        class="min-h-0 flex-1 overflow-y-auto px-2 py-2"
        onScroll={(event) => {
          if (props.active !== false && event.currentTarget.clientHeight > 0)
            savedScroll[props.tab] = event.currentTarget.scrollTop;
        }}
      >
        <Show when={isFileTab()}>
          <div
            aria-label={
              props.tab === 'Full Diff'
                ? 'Full diff files'
                : 'Walkthrough files'
            }
            class="relative"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            <For each={virtualizer.getVirtualItems()}>
              {(virtual) => {
                const row = () => rows()[virtual.index];
                return (
                  <div
                    data-index={virtual.index}
                    class="absolute inset-x-0 top-0"
                    ref={(element) =>
                      createEffect(
                        on(
                          () => virtual.key,
                          () => virtualizer.measureElement(element)
                        )
                      )
                    }
                    style={{
                      transform: `translateY(${virtual.start}px)`,
                      height: row()?.kind === 'chapter' ? undefined : '24px',
                    }}
                  >
                    <Show when={row()}>
                      {(item) => {
                        const chapter = () => {
                          const value = item();
                          return value.kind === 'chapter' ? value : undefined;
                        };
                        const entry = () => {
                          const value = item();
                          return value.kind !== 'chapter' ? value : undefined;
                        };
                        return (
                          <Show
                            when={chapter()}
                            fallback={
                              <Show when={entry()}>
                                {(entry) => {
                                  const file = () => {
                                    const node = entry().node;
                                    return node.kind === 'file'
                                      ? node
                                      : undefined;
                                  };
                                  return (
                                    <button
                                      type="button"
                                      title={entry().node.path}
                                      aria-label={entry().node.path}
                                      aria-expanded={
                                        entry().kind === 'folder'
                                          ? !collapsed().has(entry().key)
                                          : undefined
                                      }
                                      aria-current={
                                        entry().kind === 'file' &&
                                        props.activePath === entry().node.path
                                          ? 'page'
                                          : undefined
                                      }
                                      onClick={() =>
                                        entry().kind === 'folder'
                                          ? toggle(entry().key)
                                          : props.onFile(
                                              entry().node.path,
                                              entry().chapter
                                            )
                                      }
                                      data-review-tree-file={file()?.path}
                                      class={cn(
                                        'flex h-full w-full items-center gap-1.5 rounded px-2 text-left text-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-edge-focus',
                                        entry().kind === 'file' &&
                                          props.activePath ===
                                            entry().node.path &&
                                          'bg-accent/10 text-accent'
                                      )}
                                      style={{
                                        'padding-left': `${12 + entry().depth * 12}px`,
                                      }}
                                    >
                                      <Show
                                        when={entry().kind === 'folder'}
                                        fallback={
                                          <span class="flex shrink-0">
                                            <FileStatus
                                              status={file()?.status ?? ''}
                                            />
                                          </span>
                                        }
                                      >
                                        <FolderIcon class="size-3 shrink-0 text-ink-subtle" />
                                      </Show>
                                      <span class="min-w-0 flex-1 truncate">
                                        {entry().node.name}
                                      </span>
                                      <Show when={file()}>
                                        {(file) => (
                                          <ChangeBar
                                            added={file().added}
                                            removed={file().removed}
                                          />
                                        )}
                                      </Show>
                                      <Show when={entry().kind === 'folder'}>
                                        <CaretRightIcon
                                          class={cn(
                                            'size-2.5 shrink-0 text-ink-subtle',
                                            !collapsed().has(entry().key) &&
                                              'rotate-90'
                                          )}
                                        />
                                      </Show>
                                    </button>
                                  );
                                }}
                              </Show>
                            }
                          >
                            {(group) => (
                              <div
                                class={cn(
                                  'my-0.5 rounded',
                                  group().chapter === props.chapter &&
                                    'bg-surface-2'
                                )}
                              >
                                <button
                                  type="button"
                                  title={group().title}
                                  aria-label={group().title}
                                  data-review-chapter={group().key}
                                  aria-expanded={!collapsed().has(group().key)}
                                  aria-current={
                                    group().chapter === props.chapter
                                      ? 'step'
                                      : undefined
                                  }
                                  onClick={() => {
                                    const opening = collapsed().has(
                                      group().key
                                    );
                                    toggle(group().key);
                                    const index = group().chapter;
                                    if (
                                      opening &&
                                      index !== undefined &&
                                      index !== props.chapter
                                    )
                                      props.onChapter(index);
                                  }}
                                  class="flex min-h-8 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-edge-focus"
                                >
                                  <span class="min-w-0 flex-1 font-medium">
                                    {group().title}
                                  </span>
                                  <span class="shrink-0 text-[10px] tabular-nums text-ink-subtle">
                                    {group().count}
                                  </span>
                                  <CaretRightIcon
                                    class={cn(
                                      'size-3 shrink-0 text-ink-subtle',
                                      !collapsed().has(group().key) &&
                                        'rotate-90'
                                    )}
                                  />
                                </button>
                                <Show
                                  when={
                                    group().chapter !== undefined &&
                                    props.chapters[group().chapter!]
                                      ?.description
                                  }
                                >
                                  {(description) => (
                                    <div
                                      data-review-chapter-description={
                                        group().chapter
                                      }
                                      class="overflow-hidden px-2 pt-0.5 pb-3 text-xs leading-[18px] text-ink-muted break-words"
                                    >
                                      <StaticMarkdown
                                        autoLink
                                        markdown={description()}
                                        theme={channelTheme}
                                        target="internal"
                                        lazy={false}
                                      />
                                    </div>
                                  )}
                                </Show>
                              </div>
                            )}
                          </Show>
                        );
                      }}
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
        <Show when={props.tab === 'Threads'}>
          <p class="mb-3 px-3 text-[10px] uppercase tracking-wider text-ink-subtle">
            {props.threads.filter((thread) => !thread.resolved).length} open
            threads
          </p>
          <For each={props.threads}>
            {(thread) => (
              <button
                type="button"
                onClick={() =>
                  props.onThread
                    ? props.onThread(thread)
                    : props.onLocation(thread.location)
                }
                class="mb-2 w-full rounded-md border border-edge-muted px-3 py-2 text-left outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-edge-focus"
              >
                <p class="mb-1 truncate font-mono text-[10px] text-ink-subtle">
                  {thread.location.path}:{thread.location.line}
                </p>
                <p class="line-clamp-3 text-xs leading-relaxed text-ink">
                  {thread.messages[0]?.body}
                </p>
                <p class="mt-2 text-[10px] text-ink-subtle">
                  {thread.outdated
                    ? 'Outdated · original context preserved'
                    : thread.resolved
                      ? 'Resolved'
                      : `${thread.messages.length} messages`}
                </p>
                <Show when={thread.outdated}>
                  <pre class="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink-subtle">
                    {thread.excerpt?.join('\n')}
                  </pre>
                  <p class="mt-1 text-[10px]">
                    Original revision {thread.originalRevision}
                  </p>
                </Show>
              </button>
            )}
          </For>
        </Show>
        <Show when={props.tab === 'History'}>
          <p class="mb-3 px-3 text-[10px] uppercase tracking-wider text-ink-subtle">
            Review revisions
          </p>
          <For
            each={Array.from(
              { length: props.latestRevision },
              (_, index) => props.latestRevision - index
            )}
          >
            {(revision) => (
              <button
                type="button"
                onClick={() => props.onRevision(revision)}
                aria-pressed={props.revision === revision}
                class={cn(
                  'mb-2 w-full rounded-md border border-edge-muted px-3 py-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-edge-focus',
                  props.revision === revision && 'bg-surface-3'
                )}
              >
                <p class="font-medium text-ink">
                  Revision {revision}
                  {revision === props.latestRevision ? ' · Latest' : ''}
                </p>
              </button>
            )}
          </For>
        </Show>
      </div>
    </aside>
  );
}

function FileStatus(props: { status: string }) {
  const kind = (): DiffFileKind | undefined => {
    const status = props.status;
    if (
      status === 'added' ||
      status === 'deleted' ||
      status === 'modified' ||
      status === 'renamed'
    )
      return status;
  };
  return (
    <Show when={kind()} fallback={<FileIcon class="size-3 text-ink-subtle" />}>
      {(kind) => <StatusLetter kind={kind()} class="font-mono text-[10px]" />}
    </Show>
  );
}

/** Diffd's compact five-block change balance, with exact totals on hover. */
function ChangeBar(props: { added: number; removed: number }) {
  const total = () => props.added + props.removed;
  const green = () => (total() ? Math.round((props.added / total()) * 5) : 0);
  const label = () =>
    `+${props.added.toLocaleString()} −${props.removed.toLocaleString()}`;
  return (
    <span
      role="img"
      aria-label={label()}
      title={label()}
      class="inline-flex shrink-0 gap-px"
    >
      <For each={[0, 1, 2, 3, 4]}>
        {(index) => (
          <span
            class={cn(
              'size-[4px] rounded-[1px]',
              !total()
                ? 'bg-edge'
                : index < green()
                  ? 'bg-success'
                  : 'bg-failure'
            )}
          />
        )}
      </For>
    </span>
  );
}
