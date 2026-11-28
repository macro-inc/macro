import {
  createDiffComments,
  DiffCounts,
  DiffView,
  StatusLetter,
} from '@app/components/diff-view';
import type { LineRange } from '@app/components/diff-view/model/lines';
import { useChanges } from '@app/features/changes/changes';
import { t } from '@app/lib/i18n';
import { useFlow } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowsClockwise from '@icon/system/regular/arrows-clockwise.svg';
import ArrowsIn from '@icon/system/regular/arrows-in.svg';
import Chat from '@icon/system/regular/chat.svg';
import Copy from '@icon/system/regular/copy.svg';
import DotsThree from '@icon/system/regular/dots-three.svg';
import File from '@icon/system/regular/file.svg';
import Funnel from '@icon/system/regular/funnel.svg';
import MagnifyingGlass from '@icon/system/regular/magnifying-glass.svg';
import Sidebar from '@icon/system/regular/sidebar-simple.svg';
import * as Popover from '@kobalte/core/popover';
import { Key } from '@solid-primitives/keyed';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button, Card, Checkbox, CopyButton, Dropdown, Input } from '@ui';
import { FileTree } from '@ui/components/FileTree';
import { buildFileTree, visibleNodes } from '@ui/utils/file-tree';
import { createMemo, createSignal, Match, Show, Switch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { usePrPage } from '../../context/pr-page-context';
import {
  prCommentHasInlineAnchor,
  prFileCommentCounts,
} from '../../primitives/pr-page-state';
import { prPageDiffThreads } from '../../primitives/pr-page-timeline';
import { PrTimelineComment } from './pr-timeline';

type PrTreeState = {
  query: string;
  searchOpen: boolean;
  filter: 'all' | 'commented' | 'unviewed';
  popover: boolean;
  closedFolders: string[];
};
export function PrChangesView(props: { scroller?: HTMLDivElement }) {
  const { page, actions } = usePrPage();
  const flow = useFlow();
  const { model, review, layout, diffStyle, setDiffStyle, context } =
    useChanges();
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const [width, setWidth] = createSignal(0);
  createResizeObserver(root, (entries) => setWidth(entries.width));
  const docked = () => width() >= 1162;
  const [tree, setTree] = createStore<PrTreeState>({
    query: '',
    searchOpen: false,
    filter: 'all',
    popover: false,
    closedFolders: [],
  });
  const storedComments = createMemo(() => page()?.comments ?? []);
  const pendingComments = createMemo(() => page()?.pendingComments ?? []);
  const timeline = createMemo(() => page()?.timeline ?? []);
  const threads = createMemo(() =>
    prPageDiffThreads(timeline(), pendingComments())
  );
  const counts = createMemo(() => prFileCommentCounts(storedComments()));
  const viewed = () => page()?.viewedFiles;
  const viewedCount = () =>
    model.files().filter((file) => viewed()?.includes(file.path)).length;
  const files = () =>
    model.files().filter((file) => {
      if (!file.path.toLowerCase().includes(tree.query.trim().toLowerCase()))
        return false;
      if (tree.filter === 'commented') return (counts()[file.path] ?? 0) > 0;
      if (tree.filter === 'unviewed') return !viewed()?.includes(file.path);
      return true;
    });
  const [draft, setDraft] = createSignal<{ range: LineRange; text: string }>();
  const comments = createDiffComments({
    items: threads,
    rangeOf: (thread): LineRange => ({
      path: thread.comment.path,
      side: thread.comment.diffSide,
      lineNumber: thread.comment.startLine ?? thread.comment.line,
      endLineNumber: thread.comment.line,
      startSide: thread.comment.startSide,
    }),
    draft: [draft, setDraft],
    canComment: () =>
      actions.addToReview.available() || actions.comment.available(),
    render: (spot) => (
      <div class="flex flex-col gap-3 px-3 py-2 font-sans">
        <Key
          each={spot.items}
          by={(thread) => `${thread.comment.source}:${thread.comment.id}`}
        >
          {(thread) => (
            <Card variant="raised">
              <Card.Body class="px-3 py-0">
                <PrTimelineComment
                  comment={thread().comment}
                  replies={thread().replies}
                  pending={thread().pending}
                  onFile={(path) => review.activate(path)}
                />
              </Card.Body>
            </Card>
          )}
        </Key>
        <Show when={spot.draft}>
          {(current) => (
            <Card variant="raised">
              <Card.Body class="p-0">
                <form
                  class="flex flex-col gap-2 p-3 font-sans"
                  onSubmit={(event) => {
                    event.preventDefault();
                    fireAndForget(
                      submitLineComment(
                        actions.addToReview.available() ? 'review' : 'now'
                      ),
                      'pr-review-comment'
                    );
                  }}
                >
                  <textarea
                    class="min-h-20 w-full rounded-md bg-input p-3 text-sm"
                    aria-label={t('prPage.comment')}
                    value={current().text}
                    onInput={(event) =>
                      comments.editDraft(event.currentTarget.value)
                    }
                  />
                  <div class="flex flex-wrap items-center gap-2">
                    <Show when={actions.addToReview.available()}>
                      <Button
                        size="sm"
                        type="submit"
                        disabled={!current().text.trim() || actions.pending()}
                      >
                        {t('prPage.addToReview')}
                      </Button>
                    </Show>
                    <Show when={actions.comment.available()}>
                      <Button
                        size="sm"
                        type="button"
                        variant="secondary"
                        disabled={!current().text.trim() || actions.pending()}
                        onClick={() =>
                          fireAndForget(
                            submitLineComment('now'),
                            'pr-comment-now'
                          )
                        }
                      >
                        {t('prPage.commentNow')}
                      </Button>
                    </Show>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={comments.cancelDraft}
                    >
                      {t('prPage.cancel')}
                    </Button>
                  </div>
                </form>
              </Card.Body>
            </Card>
          )}
        </Show>
      </div>
    ),
  });
  async function submitLineComment(mode: 'review' | 'now') {
    const current = comments.draft();
    if (!current || !current.text.trim() || actions.pending()) return;
    const available =
      mode === 'review'
        ? actions.addToReview.available()
        : actions.comment.available();
    if (!available) return;
    const anchor = {
      path: current.range.path,
      line: current.range.endLineNumber,
      diffSide: current.range.side,
      startLine: current.range.lineNumber,
      startSide: current.range.startSide,
    };
    await flow.task(
      mode === 'review' ? 'pr.add-to-review' : 'pr.comment-line',
      async () => {
        if (mode === 'review')
          await actions.addToReview.run?.({
            id: Date.now(),
            source: 'review_comment',
            ...anchor,
            body: current.text.trim(),
          });
        else await actions.comment.run?.(current.text.trim(), anchor);
      }
    );
    if (comments.draft() === current) comments.cancelDraft();
  }
  const refresh = () => fireAndForget(model.refresh(), 'pr-changes-refresh');
  const copyPath = async (path: string) => {
    const copied = await flow.task('pr.copy-path', () =>
      context.host.copyText(path)
    );
    if (!copied) context.host.notify(t('prPage.copyFailed'), 'failure');
    return copied;
  };
  const collapseFolders = () =>
    setTree(
      'closedFolders',
      visibleNodes(
        buildFileTree(model.files(), (file) => file.path),
        () => true
      ).flatMap(({ node }) => (node.kind === 'directory' ? [node.path] : []))
    );
  const TreeBody = () => (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex h-12 shrink-0 items-center gap-1 border-b border-edge-muted bg-panel px-3">
        <span class="flex-1 text-sm">
          {t('prPage.files')} {model.files().length}
        </span>
        <Show when={viewed()}>
          <span class="text-xs text-ink-muted">
            {t('prPage.viewedProgress', {
              count: viewedCount(),
              total: model.files().length,
            })}
          </span>
        </Show>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('prPage.searchFiles')}
          aria-expanded={tree.searchOpen}
          onClick={() =>
            setTree({
              searchOpen: !tree.searchOpen,
              query: tree.searchOpen ? '' : tree.query,
            })
          }
        >
          <MagnifyingGlass class="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('prPage.collapseFolders')}
          onClick={collapseFolders}
        >
          <ArrowsIn class="size-4" />
        </Button>
        <Dropdown>
          <Dropdown.Trigger
            as={Button}
            size="icon-sm"
            variant="ghost"
            aria-label={t('prPage.filterFiles')}
          >
            <Funnel class="size-4" />
          </Dropdown.Trigger>
          <Dropdown.Content>
            <Dropdown.Item onSelect={() => setTree('filter', 'all')}>
              {t('prPage.allFiles')}
            </Dropdown.Item>
            <Dropdown.Item onSelect={() => setTree('filter', 'commented')}>
              {t('prPage.commented')}
            </Dropdown.Item>
            <Show when={viewed()}>
              <Dropdown.Item onSelect={() => setTree('filter', 'unviewed')}>
                {t('prPage.unviewed')}
              </Dropdown.Item>
            </Show>
          </Dropdown.Content>
        </Dropdown>
      </div>
      <Show when={tree.searchOpen}>
        <div class="p-2">
          <Input
            type="search"
            aria-label={t('prPage.searchFiles')}
            placeholder={t('prPage.searchFiles')}
            value={tree.query}
            onInput={(event) => setTree('query', event.currentTarget.value)}
          />
        </div>
      </Show>
      <div class="min-h-0 flex-1 overflow-y-auto p-2">
        <FileTree.Root
          aria-label={t('prPage.files')}
          items={files()}
          path={(file) => file.path}
          selected={review.active()}
          closedPaths={tree.closedFolders}
          onClosedPathsChange={(paths) => setTree('closedFolders', paths)}
          onSelect={(file) => {
            review.activate(file.path);
            setTree('popover', false);
          }}
        >
          {(node) => (
            <>
              <FileTree.Icon>
                <File class="size-4" />
              </FileTree.Icon>
              <FileTree.Name
                class={
                  viewed()?.includes(node.path) && review.active() !== node.path
                    ? 'text-ink-extra-muted'
                    : undefined
                }
              />
              <Show when={counts()[node.path]}>
                <span class="inline-flex items-center gap-1 text-xs text-ink-muted">
                  <Chat class="size-3" />
                  {counts()[node.path]}
                </span>
              </Show>
              <DiffCounts
                additions={node.item.additions}
                deletions={node.item.deletions}
              />
              <StatusLetter kind={node.item.kind} />
            </>
          )}
        </FileTree.Root>
        <Show when={files().length === 0}>
          <p class="p-3 text-sm text-ink-muted">{t('prPage.noFiles')}</p>
        </Show>
      </div>
    </div>
  );
  return (
    <div
      ref={setRoot}
      class="relative flex min-h-[calc(var(--pr-page-height)-var(--pr-tabs-height))] min-w-0 bg-panel @container/pr-changes"
    >
      <DiffView.Root
        files={model.files()}
        patch={model.patch() ?? ''}
        diffStyle={width() >= 802 ? diffStyle() : 'unified'}
        active={review.active()}
        collapse={{
          isCollapsed: review.isCollapsed,
          toggle: review.toggleCollapsed,
          toggleAll: review.toggleAllCollapsed,
          anyExpanded: review.anyExpanded,
        }}
      >
        <div data-pr-diff class="flex min-w-0 flex-1 flex-col">
          <div
            class="sticky z-10 flex h-12 shrink-0 items-center gap-2 border-b border-edge-muted bg-panel px-4 @min-[720px]/pr-changes:pl-[58px] @min-[720px]/pr-changes:pr-6"
            style={{ top: 'var(--pr-tabs-height, 0px)' }}
          >
            <Show when={width() >= 802}>
              <DiffView.StyleToggle
                value={diffStyle()}
                onChange={setDiffStyle}
              />
            </Show>
            <span class="flex-1" />
            <div class="hidden items-center gap-1 @min-[401px]/pr-changes:flex">
              <DiffView.CollapseAll iconOnly />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('prPage.refresh')}
                disabled={model.refreshing()}
                onClick={refresh}
              >
                <ArrowsClockwise class="size-4" />
              </Button>
            </div>
            <div class="@min-[401px]/pr-changes:hidden">
              <Dropdown>
                <Dropdown.Trigger
                  as={Button}
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('prPage.diffControls')}
                >
                  <DotsThree class="size-4" />
                </Dropdown.Trigger>
                <Dropdown.Content>
                  <Dropdown.Item onSelect={review.toggleAllCollapsed}>
                    {t('prPage.collapseAll')}
                  </Dropdown.Item>
                  <Dropdown.Item onSelect={refresh}>
                    {t('prPage.refresh')}
                  </Dropdown.Item>
                </Dropdown.Content>
              </Dropdown>
            </div>
            <Popover.Root
              open={!docked() && tree.popover}
              onOpenChange={(open) => setTree('popover', open)}
              placement="bottom-end"
            >
              <Switch>
                <Match when={docked()}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('prPage.tree')}
                    aria-pressed={layout.treeOpen()}
                    onClick={layout.toggleTree}
                  >
                    <Sidebar class="size-4" />
                  </Button>
                </Match>
                <Match when={!docked()}>
                  <Popover.Trigger
                    as={Button}
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('prPage.tree')}
                  >
                    <Sidebar class="size-4" />
                  </Popover.Trigger>
                </Match>
              </Switch>
              <Popover.Portal>
                <Popover.Content
                  class="menu-surface z-modal flex h-[min(560px,75vh)] w-80 max-w-[90vw] flex-col overflow-hidden rounded-xl"
                  aria-label={t('prPage.files')}
                >
                  <TreeBody />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
          <Show when={model.refreshError()}>
            {(error) => (
              <p role="status" class="px-4 py-2 text-sm text-failure">
                {error()}
              </p>
            )}
          </Show>
          <Switch>
            <Match when={model.patchStatus() === 'error'}>
              <div class="flex flex-1 flex-col items-center justify-center gap-3">
                <span class="text-sm text-ink-muted">
                  {t('prPage.loadChangesError')}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={model.retryPatch}
                >
                  {t('prPage.retry')}
                </Button>
              </div>
            </Match>
            <Match
              when={model.patch() !== undefined && model.files().length > 0}
            >
              <DiffView.Stack
                scrollElement={props.scroller}
                stickyOffset="calc(var(--pr-tabs-height, 0px) + 3rem)"
                contentClass="px-4 @min-[720px]/pr-changes:pl-[58px] @min-[720px]/pr-changes:pr-6"
                headerClass="rounded-t-none bg-panel"
                hunkSeparators="metadata"
                unsafeCSS="[data-separator] { background: rgb(from var(--color-accent) r g b / 0.1); color: var(--color-ink); }"
                footer={(entry) => (
                  <div class="px-3">
                    <Key
                      each={page()?.timeline.flatMap((item) =>
                        item.kind === 'github-comment' &&
                        item.item.path === entry.file.path &&
                        (!entry.diff || !prCommentHasInlineAnchor(item.item))
                          ? [item]
                          : []
                      )}
                      by={(item) => `${item.item.source}:${item.item.id}`}
                    >
                      {(item) => (
                        <Card variant="raised">
                          <Card.Body class="px-3 py-0">
                            <PrTimelineComment
                              comment={item().item}
                              replies={item().replies}
                              onFile={(path) => review.activate(path)}
                            />
                          </Card.Body>
                        </Card>
                      )}
                    </Key>
                  </div>
                )}
                header={(entry) => (
                  <>
                    <DiffView.CollapseButton />
                    <StatusLetter kind={entry.file.kind} />
                    <span
                      class="min-w-0 flex-1 truncate text-sm font-medium"
                      title={entry.file.path}
                    >
                      {entry.file.path.split('/').at(-1)}{' '}
                      <span class="hidden font-normal text-ink-muted @min-[401px]/pr-changes:inline">
                        {entry.file.path.slice(
                          0,
                          entry.file.path.lastIndexOf('/') + 1
                        )}
                      </span>
                    </span>
                    <CopyButton
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('prPage.copyPath')}
                      icon={<Copy class="size-3.5" />}
                      onClick={() => copyPath(entry.file.path)}
                    />
                    <DiffView.FileCounts />
                    <Show when={counts()[entry.file.path]}>
                      <span class="inline-flex items-center gap-1 text-xs text-ink-muted">
                        <Chat class="size-3.5" />
                        {counts()[entry.file.path]}
                      </span>
                    </Show>
                    <Show when={actions.markViewed.available()}>
                      <Checkbox
                        size="sm"
                        aria-label={t('prPage.markViewed')}
                        checked={viewed()?.includes(entry.file.path) ?? false}
                        onChange={(value) =>
                          fireAndForget(
                            Promise.resolve(
                              actions.markViewed.run?.(entry.file.path, value)
                            ),
                            'pr-mark-viewed'
                          )
                        }
                      >
                        <Checkbox.Control />
                        <Checkbox.Label class="hidden text-xs text-ink-muted @min-[401px]/pr-changes:inline">
                          {t('prPage.viewed')}
                        </Checkbox.Label>
                      </Checkbox>
                    </Show>
                  </>
                )}
                annotations={comments.annotations}
                renderAnnotation={comments.renderAnnotation}
                selection={comments.selection}
                onSelectLines={comments.onSelectLines}
              />
            </Match>
            <Match
              when={
                model.state().kind === 'load_error' ||
                model.state().kind === 'failed'
              }
            >
              <div class="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-ink-muted">
                <span>{t('prPage.loadChangesError')}</span>
                <Button size="sm" variant="secondary" onClick={refresh}>
                  {t('prPage.retry')}
                </Button>
              </div>
            </Match>
            <Match
              when={
                model.state().kind === 'loading' ||
                model.state().kind === 'capturing' ||
                model.patchStatus() === 'pending'
              }
            >
              <div class="flex flex-1 items-center justify-center text-sm text-ink-muted">
                {t('prPage.loading')}
              </div>
            </Match>
            <Match when={true}>
              <div class="flex flex-1 items-center justify-center text-sm text-ink-muted">
                {t('prPage.noChanges')}
              </div>
            </Match>
          </Switch>
        </div>
        <Show when={docked() && layout.treeOpen()}>
          <aside
            class="sticky flex w-[360px] shrink-0 flex-col self-start border-l border-edge-muted bg-panel"
            style={{
              top: 'var(--pr-tabs-height, 0px)',
              height: 'calc(var(--pr-page-height) - var(--pr-tabs-height))',
            }}
          >
            <TreeBody />
          </aside>
        </Show>
      </DiffView.Root>
    </div>
  );
}
