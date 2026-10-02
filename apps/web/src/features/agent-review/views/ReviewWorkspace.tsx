import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import ListIcon from '@phosphor/list.svg';
import XIcon from '@phosphor/x.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button, cn } from '@ui';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { ReviewDiscussion } from '../components/ReviewDiscussion';
import { ReviewGraph } from '../components/ReviewGraph';
import { ReviewGraphPreview } from '../components/ReviewGraphPreview';
import {
  type NavigationTab,
  ReviewNavigation,
} from '../components/ReviewNavigation';
import { ReviewWalkthrough } from '../components/ReviewWalkthrough';
import { useReviewHost } from '../context/review-context';
import type { CodeLocation } from '../core/model';
import { readerFiles } from '../core/reader-files';
import { createReview, errorMessage } from '../primitives/create-review';
import { ReviewFiles } from './ReviewFiles';
import '../components/reader.css';

const same = (a: CodeLocation | undefined, b: CodeLocation) =>
  a?.path === b.path && a.side === b.side && a.line === b.line;
export default function ReviewWorkspace() {
  const host = useReviewHost();
  const model = createReview(host);
  const [tab, setTab] = createSignal<NavigationTab>('Walkthrough');
  const [readingMode, setReadingMode] = createSignal<
    'Walkthrough' | 'Full Diff'
  >('Walkthrough');
  const [sidebar, setSidebar] = createSignal(false);
  const [main, setMain] = createSignal<HTMLElement>();
  const size = createElementSize(main);
  const wide = createMemo(
    (previous: boolean) =>
      host.open() && main()?.isConnected && size.width
        ? size.width >= 720
        : previous,
    false
  );
  const [observing, setObserving] = createSignal(false);
  const [searchOpen, setSearchOpen] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;
  let root!: HTMLElement;
  const [attachHotkeys, scope] = useHotkeyDOMScope('agent-review');
  const [search, setSearch] = createSignal('');
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const entry = () =>
    model.manifest()?.files.find((item) => item.path === model.target()?.path);
  const chapters = createMemo(() =>
    (model.review()?.tour ?? []).map((chapter) => ({ ...chapter, note: '' }))
  );
  const overviewCount = () => (model.review()?.graph ? 1 : 0);
  const [graphFocus, setGraphFocus] = createSignal<string>();
  const showOverview = (node?: string) => {
    setGraphFocus(node);
    model.showOverview();
    setTab('Walkthrough');
    setReadingMode('Walkthrough');
    setSidebar(false);
  };
  const chooseStep = (index: number) => {
    if (index === 0 && overviewCount()) showOverview();
    else model.chooseChapter(index - overviewCount());
  };
  const chapterIndex = () => {
    const path = model.target()?.path ?? '';
    const current = model.chapter();
    return chapters()[current]?.paths.includes(path)
      ? current
      : chapters().findIndex((chapter) => chapter.paths.includes(path));
  };
  const files = () => model.manifest()?.files ?? [];
  const walkthroughFiles = createMemo(() => {
    const visible = model.visibleFiles();
    const target = entry();
    return target && !visible.some((file) => file.path === target.path)
      ? [...visible, target]
      : visible;
  });
  const readingFiles = createMemo(() =>
    readerFiles(
      readingMode() === 'Full Diff' ? files() : walkthroughFiles(),
      chapters(),
      readingMode() !== 'Full Diff'
    )
  );
  const totals = createMemo(() =>
    files().reduce(
      (sum, f) => ({
        added: sum.added + f.added,
        removed: sum.removed + f.removed,
      }),
      { added: 0, removed: 0 }
    )
  );
  const navigate = (location: CodeLocation, node?: string) => {
    model.navigate(location, node);
    setSidebar(false);
  };
  const notes = () => model.review()?.annotations ?? [];
  const discussions = createMemo(
    () => {
      const all = [
        ...model
          .threads()
          .filter((t) => !t.outdated)
          .map((t) => t.location),
        ...notes().map((a) => a.location),
        ...(model.composing() &&
        model.composeRevision() === model.currentRevision()
          ? [model.composing()!]
          : []),
      ];
      return all.filter(
        (at, i) => all.findIndex((other) => same(other, at)) === i
      );
    },
    undefined,
    {
      equals: (a, b) =>
        Boolean(
          a &&
            a.length === b.length &&
            a.every((at, i) => same(at, b[i]) && at.endLine === b[i].endLine)
        ),
    }
  );
  const missingReview = () =>
    host.reviewId() && model.review() && host.reviewId() !== model.review()?.id;
  onMount(() => {
    const timer = setInterval(() => {
      if (
        host.open() &&
        host.canEdit() &&
        document.visibilityState === 'visible' &&
        model.review()?.source === 'workspace' &&
        !model.review()?.revisions.at(-1)?.comparison.head &&
        !model.source.capturing()
      )
        void model.capture(true);
    }, 15_000);
    onCleanup(() => clearInterval(timer));
  });
  const openSearch = () => {
    setSearchOpen(true);
    queueMicrotask(() => {
      searchInput?.focus({ preventScroll: true });
      searchInput?.select();
    });
  };
  const closeSearch = () => {
    setSearch('');
    setSearchOpen(false);
    root
      .querySelector<HTMLElement>('[data-review-scroll]')
      ?.focus({ preventScroll: true });
  };
  const cancelComment = () => {
    if (
      document.activeElement instanceof HTMLTextAreaElement &&
      root.contains(document.activeElement)
    )
      root.focus({ preventScroll: true });
    model.cancel();
  };
  registerHotkey({
    scopeId: scope,
    hotkey: '/',
    description: 'Find in file',
    condition: () => host.open() && !model.overview(),
    keyDownHandler: () => {
      openSearch();
      return true;
    },
  });
  registerHotkey({
    scopeId: scope,
    hotkey: 'r',
    description: 'Refresh review',
    condition: host.open,
    keyDownHandler: () => {
      if (host.canEdit() && !model.source.capturing()) void model.capture();
      return true;
    },
  });
  createEffect(
    on(host.open, (open) => {
      setObserving(false);
      if (open)
        queueMicrotask(() => {
          if (!host.open() || !root?.isConnected) return;
          setObserving(true);
          root.focus({ preventScroll: true });
        });
    })
  );
  const displayDiscussion = (at: CodeLocation) => (
    <>
      <For each={notes().filter((note) => same(note.location, at))}>
        {(note) => (
          <ReviewDiscussion
            note={note.body}
            draft=""
            composing={false}
            onDraft={() => {}}
            onSend={() => {}}
            onCancel={() => {}}
            onResolve={() => {}}
            onReply={() => model.begin(at)}
            readOnly={!host.canEdit() || !model.ready()}
          />
        )}
      </For>
      <For
        each={model
          .threads()
          .filter((thread) => !thread.outdated && same(thread.location, at))}
      >
        {(thread) => (
          <ReviewDiscussion
            thread={thread}
            draft={model.draft()}
            composing={
              model.composeRevision() === model.currentRevision() &&
              same(model.composing(), at) &&
              model.replyTo() === thread.id
            }
            onDraft={model.setDraft}
            onSend={() => void model.send()}
            onCancel={cancelComment}
            onResolve={() => void model.resolve(thread.id)}
            onReply={() => model.begin(at, thread.id)}
            readOnly={!host.canEdit() || !model.ready()}
            sending={model.source.commenting()}
            locked={Boolean(model.pending())}
          />
        )}
      </For>
      <Show
        when={
          model.composeRevision() === model.currentRevision() &&
          same(model.composing(), at) &&
          !model.replyTo()
        }
      >
        <ReviewDiscussion
          draft={model.draft()}
          composing
          readOnly={!host.canEdit() || !model.ready()}
          onDraft={model.setDraft}
          onSend={() => void model.send()}
          onCancel={cancelComment}
          onResolve={() => {}}
          onReply={() => {}}
          sending={model.source.commenting()}
          locked={Boolean(model.pending())}
        />
      </Show>
    </>
  );
  return (
    <section
      class="@container/review flex size-full min-h-0 min-w-0 flex-col bg-surface text-ink outline-none"
      aria-label="Code review"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (
          event.key !== 'Escape' ||
          event.defaultPrevented ||
          event.isComposing
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        if (sidebar() && root.clientWidth < 800) {
          setSidebar(false);
          root
            .querySelector<HTMLButtonElement>(
              'button[aria-label="Review navigation"]'
            )
            ?.focus({ preventScroll: true });
        } else if (searchOpen()) closeSearch();
        else if (model.composing()) {
          cancelComment();
        } else if (model.mapOpen() && !model.overview()) model.closeMap();
        else host.back();
      }}
      ref={(element) => {
        root = element;
        attachHotkeys(element);
      }}
    >
      <header class="flex shrink-0 items-center gap-3 border-b border-edge-muted px-4 py-2">
        <Button
          size="icon-sm"
          label="Review navigation"
          variant="ghost"
          class="@min-[800px]/review:hidden"
          onClick={() => setSidebar((open) => !open)}
        >
          <ListIcon />
        </Button>
        <Button size="sm" variant="ghost" onClick={host.back}>
          <ArrowLeftIcon />
          Back to session
        </Button>
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-sm font-medium">
            {model.review()?.title || 'Review changes'}
          </h1>
          <p class="truncate text-xs text-ink-subtle">
            {model.review()?.repository}
          </p>
        </div>
        <Show when={model.review()}>
          <span class="hidden text-xs @min-[600px]/review:inline">
            <DiffCounts
              additions={totals().added}
              deletions={totals().removed}
            />
          </span>
        </Show>
      </header>
      <Show when={host.savedNotes().length}>
        <details class="border-b border-edge-muted px-4 py-2 text-xs">
          <summary>Saved review notes ({host.savedNotes().length})</summary>
          <p class="mt-2 text-ink-muted">
            These notes refer to an earlier diff. Select the matching code, then
            review the comment before sending.
          </p>
          <For each={host.savedNotes()}>
            {(note) => (
              <div class="my-3 rounded border border-edge-muted p-3">
                <p class="font-mono">
                  {note.path}:{note.lineNumber}–{note.endLineNumber} ·{' '}
                  {note.side}
                </p>
                <p class="my-2 whitespace-pre-wrap">{note.text}</p>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={
                    !host.canEdit() ||
                    !model.target() ||
                    Boolean(model.pending())
                  }
                  onClick={() => {
                    const at = model.target();
                    if (!at) return;
                    model.begin(at);
                    model.setDraft(
                      `${note.text}\n\nOriginal note: ${note.path}:${note.lineNumber}–${note.endLineNumber} (${note.side}), saved ${note.createdAt}.`
                    );
                  }}
                >
                  Use with selected code
                </Button>
              </div>
            )}
          </For>
        </details>
      </Show>
      <Show when={model.notice()}>
        <p
          role="status"
          class="border-b border-edge-muted px-4 py-2 text-xs text-ink-muted"
        >
          {model.notice()}
        </p>
      </Show>
      <Show when={model.source.manifest.phase() === 'error'}>
        <div role="alert" class="p-6 text-sm">
          {errorMessage(model.source.manifest.error())}{' '}
          <Button
            variant="ghost"
            onClick={() => void model.source.manifest.refresh()}
          >
            Retry
          </Button>
        </div>
      </Show>
      <Show when={model.source.manifest.phase() !== 'error' && !model.review()}>
        <div class="grid flex-1 place-content-center gap-3 p-8 text-center">
          <h2 class="text-lg">
            {model.source.manifest.phase() === 'loading'
              ? 'Loading review…'
              : 'No review yet'}
          </h2>
          <p class="max-w-md text-sm text-ink-muted">
            {model.source.manifest.phase() === 'loading'
              ? 'Opening the saved comparison.'
              : 'Capture the connected workspace or linked pull request.'}
          </p>
          <Show
            when={host.canEdit() && model.source.manifest.phase() !== 'loading'}
          >
            <Button
              disabled={model.source.capturing()}
              onClick={() => void model.capture()}
            >
              {model.source.capturing() ? 'Preparing review…' : 'Open changes'}
            </Button>
          </Show>
        </div>
      </Show>
      <Show when={missingReview()}>
        <p role="alert" class="p-8">
          This link refers to a different review.
        </p>
      </Show>
      <Show when={model.review() && !missingReview()}>
        <Show when={model.currentRevision() !== model.latest()}>
          <div class="flex items-center justify-between gap-3 border-b border-edge-muted bg-accent/5 px-4 py-2 text-xs">
            <span>
              Revision {model.currentRevision()}. Revision {model.latest()} is
              available.
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => model.chooseRevision(model.latest()!)}
            >
              View latest <ArrowRightIcon />
            </Button>
          </div>
        </Show>
        <div class="relative flex min-h-0 flex-1">
          <div
            class={cn(
              'min-h-0 shrink-0 @min-[800px]/review:flex',
              sidebar()
                ? 'absolute inset-0 z-20 flex @min-[800px]/review:static'
                : 'hidden'
            )}
          >
            <ReviewNavigation
              active={observing()}
              onClose={() => setSidebar(false)}
              tab={tab()}
              onTab={(next) => {
                setTab(next);
                if (next === 'Walkthrough' || next === 'Full Diff')
                  setReadingMode(next);
                const target = model.target();
                if (next === 'Full Diff' && model.overview() && target)
                  model.navigate(target);
              }}
              chapters={chapters()}
              chapter={model.overview() ? -1 : chapterIndex()}
              onChapter={model.chooseChapter}
              overview={
                model.review()?.graph
                  ? {
                      title: model.review()!.graph!.title,
                      active: model.overview(),
                      onSelect: showOverview,
                    }
                  : undefined
              }
              files={files()}
              walkthroughFiles={model.visibleFiles()}
              fileGroups={model.fileGroups()}
              onToggleGroup={model.toggleGroup}
              activePath={model.overview() ? '' : (model.target()?.path ?? '')}
              onFile={(path, chapter) =>
                batch(() => {
                  if (chapter !== undefined) model.chooseChapter(chapter);
                  navigate({
                    path,
                    side:
                      files().find((f) => f.path === path)?.status === 'deleted'
                        ? 'old'
                        : 'new',
                    line: 1,
                  });
                })
              }
              threads={model.threads()}
              onLocation={navigate}
              onThread={(thread) => {
                if (
                  thread.outdated &&
                  thread.originalRevision &&
                  thread.originalLocation
                ) {
                  model.chooseRevision(thread.originalRevision);
                  navigate(thread.originalLocation);
                } else navigate(thread.location);
              }}
              revision={model.currentRevision() ?? 1}
              latestRevision={model.latest() ?? 1}
              onRevision={(r) => {
                model.chooseRevision(r);
                setSidebar(false);
              }}
            />
          </div>
          <main ref={setMain} class="flex min-h-0 min-w-0 flex-1 flex-col">
            <Show when={model.overview() && model.review()?.graph}>
              {(graph) => (
                <ReviewGraph
                  graph={graph()}
                  files={files()}
                  count={chapters().length + 1}
                  activeNode={graphFocus()}
                  nextChapter={chapters()[0]?.title}
                  onNext={() => model.chooseChapter(0)}
                  onLocation={navigate}
                />
              )}
            </Show>
            <div
              class={cn(
                'relative flex min-h-0 flex-1 flex-col',
                model.overview() && 'hidden'
              )}
            >
              <Show
                when={tab() === 'Walkthrough' && chapters()[chapterIndex()]}
              >
                {(chapter) => (
                  <ReviewWalkthrough
                    chapter={chapter()}
                    index={chapterIndex() + overviewCount()}
                    count={chapters().length + overviewCount()}
                    onChapter={chooseStep}
                  />
                )}
              </Show>
              <Show
                when={
                  model.review()?.summary &&
                  (tab() === 'Threads' || tab() === 'History')
                }
              >
                <details class="border-b border-edge-muted px-4 py-2 text-xs text-ink-muted">
                  <summary>Summary</summary>
                  <div class="mt-2 leading-relaxed">
                    <StaticMarkdown
                      autoLink
                      markdown={model.review()?.summary ?? ''}
                      theme={channelTheme}
                      target="internal"
                      lazy={false}
                    />
                  </div>
                </details>
              </Show>
              <Show when={searchOpen()}>
                <div class="flex gap-3 border-b border-edge-muted px-4 py-2">
                  <input
                    ref={searchInput}
                    aria-label="Find in file"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        closeSearch();
                      }
                    }}
                    placeholder="Find in file…"
                    class="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-ink-placeholder"
                    value={search()}
                    onInput={(event) => setSearch(event.currentTarget.value)}
                  />
                  <label class="flex items-center gap-2 text-xs text-ink-subtle">
                    Line
                    <input
                      aria-label="Go to line"
                      type="number"
                      min="1"
                      class="w-16 rounded border border-edge-muted bg-input px-2 text-ink"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && model.target()) {
                          const line = Number(event.currentTarget.value);
                          if (Number.isSafeInteger(line) && line > 0)
                            navigate({
                              ...model.target()!,
                              line,
                              endLine: undefined,
                            });
                        }
                      }}
                    />
                  </label>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    label="Close search"
                    onClick={closeSearch}
                  >
                    <XIcon />
                  </Button>
                </div>
              </Show>
              <Show when={readingFiles().length}>
                <ReviewFiles
                  files={readingFiles()}
                  revision={model.currentRevision()}
                  active={observing() && !model.overview()}
                  disabled={
                    model.source.loadedRevision() !== model.currentRevision() ||
                    model.source.manifest.phase() !== 'ready'
                  }
                  wide={wide()}
                  target={model.target()}
                  sequence={model.sequence()}
                  search={search()}
                  expanded={expanded()}
                  onExpand={(path) =>
                    setExpanded((old) => new Set([...old, path]))
                  }
                  onActiveFile={model.observeFile}
                  onSearch={(path) => {
                    model.observeFile(path);
                    openSearch();
                  }}
                  discussions={discussions()}
                  renderDiscussion={displayDiscussion}
                  onSelect={model.select}
                  onComment={model.begin}
                  readOnly={!host.canEdit()}
                />
              </Show>
              <Show when={!files().length}>
                <div class="grid flex-1 place-content-center p-8 text-sm text-ink-muted">
                  No changes in this comparison.
                </div>
              </Show>
              <Show when={model.target() && files().length > 0 && !entry()}>
                <p class="p-8 text-sm text-ink-muted">
                  This file is absent from revision {model.currentRevision()}.
                  Choose a file or open the original revision in History.
                </p>
              </Show>
              <Show
                when={
                  !model.overview() && model.mapOpen() && model.review()?.graph
                }
              >
                {(graph) => (
                  <ReviewGraphPreview
                    graph={graph()}
                    files={files()}
                    activeNode={model.activeGraphNode()}
                    onLocation={navigate}
                    onExpand={() => showOverview(model.activeGraphNode())}
                    onClose={model.closeMap}
                  />
                )}
              </Show>
            </div>
          </main>
        </div>
      </Show>
    </section>
  );
}

import { DiffCounts } from '@app/components/diff-view/DiffCounts';
