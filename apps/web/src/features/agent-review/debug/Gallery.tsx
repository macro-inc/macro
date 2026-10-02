/**
 * Interactive design surface. All conversation, delivery, and revision actions
 * are explicit local simulations. Real structural fixture output comes from diffd.
 */
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import LinkIcon from '@phosphor/link.svg';
import ListIcon from '@phosphor/list.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import { Button, cn, SegmentedControl } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { ReviewCode } from '../components/ReviewCode';
import { ReviewDiscussion } from '../components/ReviewDiscussion';
import {
  type NavigationTab,
  ReviewNavigation,
} from '../components/ReviewNavigation';
import type { CodeLocation, ReviewFile, ReviewThread } from '../core/model';
import { chapters, files, hugeFile, initialThreads } from './fixture';
import '../components/reader.css';

export default function AgentReviewGallery() {
  const [inReview, setInReview] = createSignal(true);
  const [tab, setTab] = createSignal<NavigationTab>('Walkthrough');
  const [chapter, setChapter] = createSignal(0);
  const [location, setLocation] = createSignal<CodeLocation>(chapters[0].focus);
  const [sequence, setSequence] = createSignal(0);
  const [style, setStyle] = createSignal<'split' | 'unified'>('split');
  const [sidebar, setSidebar] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [viewed, setViewed] = createSignal<ReadonlySet<string>>(new Set());
  const [threads, setThreads] = createSignal<ReviewThread[]>(initialThreads);
  const [draft, setDraft] = createSignal('');
  const [composing, setComposing] = createSignal<CodeLocation>();
  const [replyTo, setReplyTo] = createSignal<string>();
  const [sessionDraft, setSessionDraft] = createSignal('');
  const [revision, setRevision] = createSignal(1);
  const [latest, setLatest] = createSignal(1);
  const [stress, setStress] = createSignal<ReviewFile>();
  const [notice, setNotice] = createSignal(
    'Local sketch · no messages are sent to an agent'
  );
  const [queued, setQueued] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;

  const currentChapter = () => chapters[chapter()];
  const currentFiles = () => (stress() ? [stress()!, ...files] : files);
  const currentFile = createMemo(
    () =>
      currentFiles().find((file) => file.path === location().path) ?? files[0]
  );
  const revisionFile = createMemo(() => {
    const file = currentFile();
    if (revision() === 1 || file.path !== 'src/lib.rs' || !file.new)
      return file;
    const lines = [...file.new.lines];
    const at = lines.findIndex((line) =>
      line.includes('self.config.capacity + self.config.burst')
    );
    if (at >= 0)
      lines[at] = lines[at].replace(
        'self.config.capacity + self.config.burst',
        'self.config.capacity.saturating_add(self.config.burst)'
      );
    const novel = [...file.new.novel];
    const syntax = [...file.new.syntax];
    if (at >= 0) {
      novel[at] = [0, lines[at].length];
      syntax[at] = [];
    }
    return { ...file, new: { ...file.new, lines, novel, syntax } };
  });
  const total = files.reduce(
    (counts, file) => ({
      added: counts.added + file.added,
      removed: counts.removed + file.removed,
    }),
    { added: 0, removed: 0 }
  );

  const navigate = (target: CodeLocation) => {
    setLocation(target);
    setSequence((value) => value + 1);
    setInReview(true);
    setSidebar(false);
  };
  const selectChapter = (index: number) => {
    const next = Math.max(0, Math.min(chapters.length - 1, index));
    setChapter(next);
    setTab('Walkthrough');
    setSearch('');
    navigate(chapters[next].focus);
  };
  const openComposer = (target: CodeLocation, thread?: ReviewThread) => {
    navigate(target);
    setComposing(target);
    setReplyTo(thread?.id);
  };
  const closeComposer = () => {
    setComposing(undefined);
    setReplyTo(undefined);
  };
  const sendComment = () => {
    const target = composing();
    const body = draft().trim();
    if (!target || !body) return;
    const id = crypto.randomUUID();
    const parent = replyTo();
    setThreads((current) =>
      parent
        ? current.map((thread) =>
            thread.id === parent
              ? {
                  ...thread,
                  messages: [...thread.messages, { id, author: 'You', body }],
                }
              : thread
          )
        : [
            ...current,
            {
              id,
              location: target,
              resolved: false,
              messages: [{ id, author: 'You', body }],
            },
          ]
    );
    setDraft('');
    closeComposer();
    setQueued(true);
    setNotice(
      'Comment queued in the sketch. Use Simulate agent reply to continue the loop.'
    );
  };
  const simulateReply = () => {
    setThreads((current) =>
      current.map((thread) =>
        thread.messages.at(-1)?.author === 'You'
          ? {
              ...thread,
              messages: [
                ...thread.messages,
                {
                  id: crypto.randomUUID(),
                  author: 'Agent',
                  body: 'I checked this against the surrounding code. I’ll use saturating addition so an extreme capacity cannot overflow. The next revision keeps this thread attached to the same code.',
                },
              ],
            }
          : thread
      )
    );
    setQueued(false);
    setNotice(
      'Simulated agent reply added to the thread. Your reading position is retained.'
    );
  };
  const nextRevision = () => {
    setLatest(2);
    setRevision(2);
    setNotice(
      'Showing simulated revision 2. Select History to compare with revision 1.'
    );
  };
  const copyLink = async (target = location()) => {
    const params = new URLSearchParams({
      path: target.path,
      side: target.side,
      line: String(target.line),
      revision: String(revision()),
    });
    const url = new URL(window.location.href);
    url.hash = params.toString();
    try {
      await navigator.clipboard.writeText(url.toString());
      setNotice(
        'Sketch link copied. Reopening it returns to this file and line.'
      );
    } catch {
      setNotice(`Copy this sketch link: ${url.toString()}`);
    }
  };
  const toggleViewed = () =>
    setViewed((current) => {
      const next = new Set(current);
      if (next.has(currentFile().path)) next.delete(currentFile().path);
      else next.add(currentFile().path);
      return next;
    });
  const openStress = () => {
    const file = stress() ?? hugeFile();
    setStress(file);
    setTab('Walkthrough');
    setSearch('');
    navigate({ path: file.path, side: 'new', line: 1 });
    setNotice(
      'Synthetic 100,000 changed-line file. Only the visible rows are mounted.'
    );
  };

  onMount(() => {
    if (window.innerWidth < 800) setStyle('unified');
    const params = new URLSearchParams(window.location.hash.slice(1));
    const path = params.get('path');
    const line = Number(params.get('line'));
    if (path === 'fixtures/large-review.ts') setStress(hugeFile());
    if (
      path &&
      currentFiles().some((file) => file.path === path) &&
      Number.isInteger(line) &&
      line > 0
    ) {
      navigate({
        path,
        line,
        side: params.get('side') === 'old' ? 'old' : 'new',
      });
      if (params.get('revision') === '2') {
        setRevision(2);
        setLatest(2);
      }
    }
    const keydown = (event: KeyboardEvent) => {
      if (!inReview()) return;
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        event.preventDefault();
        searchInput?.focus();
        return;
      }
      const element = event.target;
      if (
        event.isComposing ||
        (element instanceof HTMLElement &&
          element.closest('input, textarea, [contenteditable=true]'))
      )
        return;
      if (event.key === 'Escape') {
        setSidebar(false);
        closeComposer();
      }
      if (event.key === 'ArrowRight' && event.altKey) {
        event.preventDefault();
        selectChapter(chapter() + 1);
      }
      if (event.key === 'ArrowLeft' && event.altKey) {
        event.preventDefault();
        selectChapter(chapter() - 1);
      }
    };
    window.addEventListener('keydown', keydown);
    onCleanup(() => window.removeEventListener('keydown', keydown));
  });

  const activeThreads = () =>
    threads().filter((thread) => thread.location.path === currentFile().path);
  const noteVisible = () =>
    tab() === 'Walkthrough' &&
    currentFile().path === currentChapter().focus.path;
  const discussions = () => {
    const locations = [
      ...activeThreads().map((thread) => thread.location),
      ...(noteVisible() ? [currentChapter().focus] : []),
      ...(composing()?.path === currentFile().path ? [composing()!] : []),
    ];
    return [
      ...new Map(locations.map((at) => [`${at.side}:${at.line}`, at])).values(),
    ];
  };
  const renderDiscussion = (target: CodeLocation) => {
    const { line, side } = target;
    const here = () =>
      activeThreads().filter(
        (thread) =>
          thread.location.line === line && thread.location.side === side
      );
    const isComposing = () =>
      composing()?.path === currentFile().path &&
      composing()?.line === line &&
      composing()?.side === side;
    const note = () =>
      noteVisible() &&
      line === currentChapter().focus.line &&
      side === currentChapter().focus.side
        ? currentChapter().note
        : undefined;
    const resolve = (id: string) =>
      setThreads((current) =>
        current.map((thread) =>
          thread.id === id ? { ...thread, resolved: !thread.resolved } : thread
        )
      );
    return (
      <>
        <Show when={note() || (isComposing() && !replyTo())}>
          <ReviewDiscussion
            note={note()}
            draft={draft()}
            composing={isComposing() && !replyTo()}
            onDraft={setDraft}
            onSend={sendComment}
            onCancel={closeComposer}
            onResolve={() => {}}
            onReply={() => openComposer(target)}
          />
        </Show>
        <For each={here()}>
          {(thread) => (
            <ReviewDiscussion
              thread={thread}
              draft={draft()}
              composing={isComposing() && replyTo() === thread.id}
              onDraft={setDraft}
              onSend={sendComment}
              onCancel={closeComposer}
              onResolve={() => resolve(thread.id)}
              onReply={() => openComposer(thread.location, thread)}
            />
          )}
        </For>
      </>
    );
  };

  return (
    <div
      class="@container/review flex h-full min-h-0 flex-col bg-surface text-ink"
      data-agent-review-sketch
    >
      <div class={cn('flex min-h-0 flex-1 flex-col', !inReview() && 'hidden')}>
        <header class="flex shrink-0 items-center gap-3 border-b border-edge-muted px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            label="Back to session"
            onClick={() => setInReview(false)}
          >
            <ArrowLeftIcon />
            <span class="hidden sm:inline">Back to session</span>
          </Button>
          <span class="h-5 w-px bg-edge-muted" />
          <div class="min-w-0 flex-1">
            <h1 class="truncate text-sm font-semibold tracking-tight">
              Add burst capacity to the limiter
            </h1>
            <p class="mt-0.5 truncate text-[11px] text-ink-subtle">
              macro / limiter <span class="px-1.5">·</span> main → working tree
            </p>
          </div>
          <span class="hidden items-center gap-1.5 text-xs text-ink-muted sm:flex">
            <span
              class={cn(
                'size-1.5 rounded-full',
                revision() === latest() ? 'bg-success' : 'bg-ink-subtle'
              )}
            />
            {revision() === latest() ? 'Live' : 'Historical'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setTab('History');
              setSidebar(true);
            }}
          >
            Rev {revision()} <CaretDownIcon />
          </Button>
          <Button
            size="icon-sm"
            label="Copy review link"
            onClick={() => void copyLink()}
          >
            <LinkIcon />
          </Button>
        </header>
        <div class="relative flex min-h-0 flex-1">
          <Show when={sidebar()}>
            <button
              type="button"
              aria-label="Close review navigation"
              onClick={() => setSidebar(false)}
              class="absolute inset-0 z-10 bg-ink/15 md:hidden"
            />
          </Show>
          <div
            class={cn(
              'h-full shrink-0 md:block',
              sidebar()
                ? 'absolute bottom-0 left-0 top-0 z-20 w-[260px] shadow-lg md:relative md:w-auto md:shadow-none'
                : 'hidden'
            )}
          >
            <ReviewNavigation
              active={inReview()}
              tab={tab()}
              onTab={setTab}
              chapters={chapters}
              chapter={chapter()}
              onChapter={selectChapter}
              files={currentFiles()}
              activePath={currentFile().path}
              onFile={(path) => {
                setSearch('');
                navigate({ path, side: 'new', line: 1 });
              }}
              threads={threads()}
              onLocation={navigate}
              revision={revision()}
              latestRevision={latest()}
              onRevision={(value) => {
                setRevision(value);
                setSidebar(false);
              }}
            />
          </div>
          <main class="flex min-h-0 min-w-0 flex-1 flex-col">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge-muted px-4 py-2 sm:px-5">
              <Button
                size="icon-sm"
                label="Open review navigation"
                class="md:hidden"
                onClick={() => setSidebar(true)}
              >
                <ListIcon />
              </Button>
              <span class="whitespace-nowrap text-[11px] text-ink-subtle">
                {currentFiles().length} files
              </span>
              <span class="font-mono text-[11px] text-success">
                +{stress() ? '100,160' : total.added}
              </span>
              <span class="font-mono text-[11px] text-failure">
                −{stress() ? '100,056' : total.removed}
              </span>
              <div class="flex w-full min-w-0 items-center justify-between gap-3 sm:ml-auto sm:w-auto">
                <label class="flex min-w-0 flex-1 items-center gap-1.5 text-ink-subtle">
                  <SearchIcon class="size-3.5 shrink-0" />
                  <input
                    ref={searchInput}
                    aria-label="Find in file"
                    value={search()}
                    onInput={(event) => setSearch(event.currentTarget.value)}
                    placeholder="Find in file"
                    class="w-full min-w-0 bg-transparent text-xs text-ink outline-none placeholder:text-ink-placeholder focus-visible:ring-2 focus-visible:ring-edge-focus sm:w-36"
                  />
                </label>
                <SegmentedControl
                  aria-label="Diff layout"
                  size="sm"
                  value={style()}
                  onChange={setStyle}
                  options={[
                    { value: 'unified', label: 'Unified' },
                    { value: 'split', label: 'Split' },
                  ]}
                />
              </div>
            </div>
            <Show when={tab() === 'Walkthrough'}>
              <div class="shrink-0 border-b border-edge-muted px-4 py-3 sm:px-8 sm:py-5">
                <p class="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
                  Chapter {chapter() + 1} of {chapters.length}
                </p>
                <h2 class="text-base font-semibold tracking-tight sm:text-lg">
                  {currentChapter().title}
                </h2>
                <p class="mt-1.5 max-w-2xl text-xs leading-relaxed text-ink-muted sm:text-sm">
                  {currentChapter().description}
                </p>
                <div class="mt-3 flex flex-wrap gap-1.5">
                  <For each={currentChapter().paths}>
                    {(path) => (
                      <Button
                        size="xs"
                        variant="ghost"
                        aria-pressed={currentFile().path === path}
                        onClick={() =>
                          navigate({
                            path,
                            side: 'new',
                            line:
                              path === currentChapter().focus.path
                                ? currentChapter().focus.line
                                : 1,
                          })
                        }
                      >
                        {path}
                      </Button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
            <div class="flex shrink-0 items-center gap-2 border-b border-edge-muted bg-panel px-4 py-2.5">
              <span class="text-[10px] text-ink-subtle">
                {currentFile().status === 'added'
                  ? 'A'
                  : currentFile().status === 'deleted'
                    ? 'D'
                    : 'M'}
              </span>
              <span
                class="min-w-0 flex-1 truncate font-mono text-xs"
                title={currentFile().path}
              >
                {currentFile().path}
              </span>
              <span class="hidden text-[10px] text-ink-subtle sm:block">
                {currentFile().language}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-pressed={viewed().has(currentFile().path)}
                onClick={toggleViewed}
              >
                <CheckIcon />
                Viewed
              </Button>
            </div>
            <ReviewCode
              active={inReview()}
              file={revisionFile()}
              split={style() === 'split'}
              target={location()}
              targetSequence={sequence()}
              discussions={discussions()}
              renderDiscussion={renderDiscussion}
              onSelect={(target) => openComposer(target)}
              onCopy={(target) => void copyLink(target)}
              search={search()}
            />
            <footer class="flex shrink-0 items-center gap-2 border-t border-edge-muted px-4 py-2.5 text-xs text-ink-subtle">
              <span class="min-w-0 flex-1 truncate">
                {threads().filter((thread) => !thread.resolved).length} open
                threads
                {queued() ? ' · Feedback queued' : ' · All changes saved'}
              </span>
              <Show when={tab() === 'Walkthrough'}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={chapter() === 0}
                  onClick={() => selectChapter(chapter() - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  disabled={chapter() === chapters.length - 1}
                  onClick={() => selectChapter(chapter() + 1)}
                >
                  Next chapter
                  <ArrowRightIcon />
                </Button>
              </Show>
              <Show when={stress() && currentFile().path === stress()?.path}>
                <Button
                  size="sm"
                  onClick={() =>
                    navigate({
                      path: currentFile().path,
                      side: 'new',
                      line: 100_000,
                    })
                  }
                >
                  Jump to line 100,000
                </Button>
              </Show>
            </footer>
          </main>
        </div>
      </div>
      <div class={cn('flex min-h-0 flex-1 flex-col', inReview() && 'hidden')}>
        <header class="flex items-center border-b border-edge-muted px-6 py-4">
          <h1 class="flex-1 text-sm font-semibold">
            Add burst capacity to the limiter
          </h1>
          <Button size="sm" onClick={() => setInReview(true)}>
            Review changes
            <ArrowRightIcon />
          </Button>
        </header>
        <div class="mx-auto w-full max-w-3xl flex-1 overflow-auto px-8 py-12">
          <p class="mb-8 text-sm text-ink-muted">
            Give the limiter a small burst allowance and make retry behavior
            clearer.
          </p>
          <div class="mb-3 flex items-center gap-2 text-sm font-medium">
            <SparkleIcon class="size-4 text-accent" />
            Agent
          </div>
          <p class="text-sm leading-7">
            I added a{' '}
            <button
              type="button"
              class="text-accent underline underline-offset-4"
              onClick={() => selectChapter(0)}
            >
              bounded burst allowance
            </button>
            , made{' '}
            <button
              type="button"
              class="text-accent underline underline-offset-4"
              onClick={() => selectChapter(1)}
            >
              retry timing explicit
            </button>
            , and connected it to the{' '}
            <button
              type="button"
              class="text-accent underline underline-offset-4"
              onClick={() => selectChapter(2)}
            >
              client feedback
            </button>
            .
          </p>
          <button
            type="button"
            onClick={() => selectChapter(0)}
            class="mt-6 flex w-full items-center gap-4 rounded-xl border border-edge px-5 py-4 text-left outline-none hover:bg-panel focus-visible:ring-2 focus-visible:ring-edge-focus"
          >
            <SparkleIcon class="size-5 text-accent" />
            <span class="flex-1">
              <span class="block text-sm font-medium">
                Walk through the changes
              </span>
              <span class="mt-1 block text-xs text-ink-subtle">
                4 chapters · 18 files · Live review
              </span>
            </span>
            <ArrowRightIcon class="size-4" />
          </button>
          <Show when={queued()}>
            <p class="mt-8 text-xs text-ink-subtle">
              Your review feedback is queued for this session.
            </p>
          </Show>
        </div>
        <div class="mx-auto mb-6 w-full max-w-3xl px-6">
          <textarea
            aria-label="Session message draft"
            value={sessionDraft()}
            onInput={(event) => setSessionDraft(event.currentTarget.value)}
            placeholder="Continue the conversation…"
            class="min-h-24 w-full resize-none rounded-2xl border border-edge bg-panel px-4 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
          />
          <p class="mt-2 text-xs text-ink-subtle">
            Your draft stays here while you read the diff.
          </p>
        </div>
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-t border-edge bg-panel px-3 py-2">
        <span class="rounded border border-edge px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-subtle">
          Interactive sketch
        </span>
        <Button size="xs" onClick={simulateReply} disabled={!queued()}>
          Simulate agent reply
        </Button>
        <Button size="xs" onClick={nextRevision} disabled={latest() === 2}>
          Apply next revision
        </Button>
        <Button size="xs" onClick={openStress}>
          100k-line fixture
        </Button>
        <p
          class="min-w-0 flex-1 truncate text-[10px] text-ink-subtle"
          role="status"
          title={notice()}
        >
          {notice()}
        </p>
      </div>
    </div>
  );
}
