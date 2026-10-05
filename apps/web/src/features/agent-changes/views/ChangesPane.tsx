/**
 * The Changes pane: PR metadata above a full-height file tree and diff stack,
 * with tree actions in its header and borderless controls above the diffs.
 */

import {
  createDiffComments,
  type DiffCollapse,
  DiffCounts,
  DiffView,
  StatusLetter,
} from '@app/components/diff-view';
import { Resize } from '@core/component/Resize';
import type { ResizeZoneCtx } from '@core/component/Resize/types';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import * as Dialog from '@kobalte/core/dialog';
import ArrowsClockwiseIcon from '@phosphor/arrows-clockwise.svg';
import CircleNotchIcon from '@phosphor/circle-notch.svg';
import FileIcon from '@phosphor/file.svg';
import SidebarIcon from '@phosphor/sidebar-simple.svg';
import WarningCircleIcon from '@phosphor/warning-circle.svg';
import { Button, cn, Panel } from '@ui';
import {
  CollapseTransition,
  type CollapseTransitionProps,
} from '@ui/components/CollapseTransition';
import { FileTree } from '@ui/components/FileTree';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { ChangesHeader } from '../components/ChangesHeader';
import { CaptureBanner, ChangesNotice } from '../components/ChangesNotice';
import { CopyFilePathButton } from '../components/CopyFilePathButton';
import { NoteAnnotation } from '../components/NoteAnnotation';
import { useAgentChanges } from '../context/agent-changes-controller';
import {
  type ChangesState,
  describeFileCount,
  describeRange,
} from '../core/changeset';
import { createChangesNarrow } from '../primitives/create-changes-narrow';
import {
  DEFAULT_TREE_WIDTH,
  MAX_TREE_WIDTH,
  MIN_TREE_WIDTH,
} from '../primitives/create-pane-layout';
import { ChangesTreeDrawer } from './ChangesTreeDrawer';

/** The state narrowed to one kind, for `<Match>` to hand its fields down. */
function stateOf<K extends ChangesState['kind']>(state: ChangesState, kind: K) {
  return state.kind === kind
    ? (state as Extract<ChangesState, { kind: K }>)
    : undefined;
}

/** Strips over the body: a failed refresh, and a capture over the changeset on screen. */
function CaptureBanners() {
  const { model } = useAgentChanges();
  const showsChangeset = () => model.changeset() !== undefined;
  return (
    <>
      <Show when={model.refreshError()}>
        {(message) => (
          <CaptureBanner
            tone="failure"
            text={message()}
            onRefresh={() => void model.refresh()}
            refreshing={model.refreshing()}
          />
        )}
      </Show>
      <Show when={showsChangeset() && model.state().kind === 'capturing'}>
        <CaptureBanner tone="progress" text="Capturing the changes again…" />
      </Show>
      <Show when={showsChangeset() && stateOf(model.state(), 'failed')}>
        {(current) => (
          <CaptureBanner
            tone="failure"
            text={`The last capture failed: ${current().message}`}
            onRefresh={() => void model.refresh()}
            refreshing={model.refreshing()}
          />
        )}
      </Show>
    </>
  );
}

/** Lives in the tree header while open, beside the diffs while closed. */
function ChangesTreeToggle(props: {
  narrow?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const { layout } = useAgentChanges();
  const open = () => (props.narrow ? props.open : layout.treeOpen());
  const label = () => (open() ? 'Hide file tree' : 'Show file tree');
  return props.narrow && !props.onToggle ? (
    <Dialog.Trigger
      class="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink hover:bg-hover"
      aria-label={label()}
    >
      <SidebarIcon class="size-4" />
    </Dialog.Trigger>
  ) : (
    <Button
      variant="ghost"
      size="icon-sm"
      label={label()}
      aria-expanded={open()}
      onClick={props.onToggle ?? layout.toggleTree}
    >
      <SidebarIcon />
    </Button>
  );
}

/** Borderless diff controls above the stack, scoped to the diff column's width. */
function ChangesControls(props: { narrow: boolean; drawerOpen: boolean }) {
  const { model, layout, diffStyle, setDiffStyle } = useAgentChanges();
  const refreshing = () =>
    model.refreshing() || model.state().kind === 'capturing';
  const treeVisible = () => !props.narrow && layout.treeOpen();
  return (
    <div
      class="flex min-w-0 shrink-0 items-center gap-1 px-3 pt-2"
      role="group"
      aria-label="Diff controls"
    >
      <Show
        when={props.narrow}
        fallback={
          <Show when={!layout.treeOpen()}>
            <ChangesTreeToggle />
          </Show>
        }
      >
        <ChangesTreeToggle narrow open={props.drawerOpen} />
      </Show>
      <Show when={!treeVisible()}>
        <span class="truncate px-1 text-xs text-ink-subtle">
          {describeFileCount(model.files().length)}
        </span>
      </Show>
      <Show when={!isTouchDevice()}>
        <DiffView.StyleToggle
          value={diffStyle()}
          onChange={setDiffStyle}
          class="shrink-0"
        />
      </Show>
      <span class="flex-1" />
      <DiffView.CollapseAll iconOnly />
      <Button
        variant="ghost"
        size="icon-sm"
        label="Refresh pull request changes"
        disabled={refreshing()}
        onClick={() => void model.refresh()}
      >
        <ArrowsClockwiseIcon class={cn(refreshing() && 'animate-spin')} />
      </Button>
    </div>
  );
}

/** Count on the left, with the tree visibility toggle on the right. */
function ChangesTreeHeader(props: { narrow: boolean; onClose: () => void }) {
  const { model, layout } = useAgentChanges();
  return (
    <div
      class="flex min-w-0 shrink-0 items-center justify-between gap-1 px-3 pt-2 pb-1"
      role="group"
      aria-label="File tree controls"
    >
      <span class="truncate text-xs text-ink-subtle">
        {describeFileCount(model.files().length)}
      </span>
      <ChangesTreeToggle
        narrow={props.narrow}
        open={true}
        onToggle={() => (props.narrow ? props.onClose() : layout.toggleTree())}
      />
    </div>
  );
}

/** The tree beside the diff stack, both over the changeset's files. */
function ChangesBody() {
  const [body, setBody] = createSignal<HTMLDivElement>();
  const narrow = createChangesNarrow(body);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const closeDrawer = () => setDrawerOpen(false);
  return (
    <Dialog.Root
      open={narrow() && drawerOpen()}
      onOpenChange={setDrawerOpen}
      modal={false}
    >
      <ChangesBodyContent
        body={setBody}
        narrow={narrow}
        drawerOpen={drawerOpen}
        closeDrawer={closeDrawer}
      />
    </Dialog.Root>
  );
}

function ChangesBodyContent(props: {
  body: (element: HTMLDivElement) => void;
  narrow: Accessor<boolean>;
  drawerOpen: Accessor<boolean>;
  closeDrawer: () => void;
}) {
  const { model, review, layout, copyPath, context } = useAgentChanges();
  const notes = createDiffComments({
    items: review.notes,
    rangeOf: (note) => note,
    draft: [review.draft, review.setDraft],
    canComment: () => context.host.agent !== undefined,
    render: (spot) => (
      <NoteAnnotation
        notes={spot.items}
        draft={spot.draft}
        onDraft={notes.editDraft}
        onAdd={review.addNote}
        onCancel={review.cancelNote}
        onRemove={review.removeNote}
      />
    ),
  });
  const treeVisible = () => !props.narrow() && layout.treeOpen();
  const [treePresent, setTreePresent] = createSignal(treeVisible());
  const [wideDock, setWideDock] = createSignal<HTMLDivElement>();
  const [drawerDock, setDrawerDock] = createSignal<HTMLDivElement>();
  let treeBody!: HTMLDivElement;
  let diffBody: HTMLDivElement | undefined;
  let zone: ResizeZoneCtx | undefined;
  let finishTreeMotion: (() => void) | undefined;
  let expandedTreeSize: Accessor<number> = layout.treeWidth;
  const drawerWidth = () => {
    const available = zone?.size() ?? DEFAULT_TREE_WIDTH;
    return Math.min(
      DEFAULT_TREE_WIDTH,
      Math.max(Math.min(MIN_TREE_WIDTH, available), available - 32)
    );
  };
  const treePanel = () =>
    wideDock()?.closest<HTMLElement>('[data-resize-panel]');
  const companions: NonNullable<CollapseTransitionProps['companions']> = ({
    opening,
    from,
    interrupted,
  }) => {
    const panel = treePanel();
    const diffPanel = diffBody?.parentElement;
    const root = panel?.parentElement;
    if (!panel || !diffPanel || !root) return [];
    const width = zone?.size() ?? root.clientWidth;
    const fromOffset = from > 0 ? from + 1 : 0;
    const toOffset = opening ? expandedTreeSize() + 1 : 0;
    const current = getComputedStyle(diffPanel);
    const animations: { target: HTMLElement; keyframes: Keyframe[] }[] = [
      {
        target: diffPanel,
        keyframes: [
          interrupted
            ? { left: current.left, width: current.width }
            : { left: `${fromOffset}px`, width: `${width - fromOffset}px` },
          { left: `${toOffset}px`, width: `${width - toOffset}px` },
        ],
      },
    ];
    const gutter = root.querySelector<HTMLElement>('[role="separator"]');
    if (gutter) {
      gutter.inert = !opening;
      gutter.setAttribute('aria-hidden', String(!opening));
      const inset = Number.parseFloat(gutter.style.left) - expandedTreeSize();
      animations.push({
        target: gutter,
        keyframes: [
          {
            left:
              interrupted && gutter.getAnimations?.().length
                ? getComputedStyle(gutter).left
                : `${from + inset}px`,
          },
          { left: `${(opening ? expandedTreeSize() : 0) + inset}px` },
        ],
      });
    }
    return animations;
  };
  const finishTreeAnimation = () => finishTreeMotion?.();
  const settleTreeAnimation = (event: PointerEvent | KeyboardEvent) => {
    if (
      !(event.target instanceof Element) ||
      !event.target.closest('[role="separator"]')
    )
      return;
    finishTreeAnimation();
  };
  // Construct once under Dialog.Root so directory state survives docking and hiding.
  const tree = (
    <div
      ref={treeBody}
      class="flex size-full min-w-0 flex-col overflow-hidden"
      inert={!(treeVisible() || (props.narrow() && props.drawerOpen()))}
      aria-hidden={!(treeVisible() || (props.narrow() && props.drawerOpen()))}
    >
      <ChangesTreeHeader narrow={props.narrow()} onClose={props.closeDrawer} />
      <div class="min-h-0 flex-1 overflow-y-auto p-2 pt-1">
        <FileTree.Root
          aria-label="Changed files"
          items={model.files()}
          path={(file) => file.path}
          selected={review.active()}
          onSelect={(file) => {
            review.activate(file.path);
            props.closeDrawer();
          }}
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
      </div>
    </div>
  );
  createEffect(() => {
    const target = props.narrow() ? drawerDock() : wideDock();
    if (target && tree instanceof Node && treeBody.parentElement !== target)
      target.append(tree);
  });
  createEffect(
    on(
      props.narrow,
      () => {
        finishTreeAnimation();
        if (!props.narrow()) props.closeDrawer();
      },
      { defer: true }
    )
  );
  return (
    <Panel.Body class="relative flex flex-col">
      <div
        ref={props.body}
        class="relative flex size-full min-h-0 min-w-0 flex-col"
      >
        <CaptureBanners />
        <Show when={model.changeset()?.truncated}>
          <CaptureBanner
            tone="failure"
            text="Some diffs were left out to fit the size budget; the file list is complete."
          />
        </Show>
        <div
          class="min-h-0 flex-1"
          ref={(element) => {
            element.addEventListener('pointerdown', settleTreeAnimation, true);
            element.addEventListener('keydown', settleTreeAnimation, true);
            onCleanup(() => {
              element.removeEventListener(
                'pointerdown',
                settleTreeAnimation,
                true
              );
              element.removeEventListener('keydown', settleTreeAnimation, true);
            });
          }}
        >
          <Resize.Zone
            direction="horizontal"
            gutter={1}
            class="overflow-hidden"
            captureResizeCtx={(ctx) => {
              if (zone === ctx) return;
              zone = ctx;
              const size = ctx.sizeOf('changes-file-tree');
              expandedTreeSize = createMemo<number>((previous) => {
                const solved = size();
                return treeVisible() && solved > 0
                  ? solved
                  : (previous ?? layout.treeWidth());
              });
              // Outer split and viewport changes invalidate pixel animation endpoints.
              createEffect(on(ctx.size, finishTreeAnimation, { defer: true }));
            }}
          >
            <Resize.Panel
              id="changes-file-tree"
              index={0}
              minSize={MIN_TREE_WIDTH}
              maxSize={MAX_TREE_WIDTH}
              target={{ kind: 'px', px: layout.treeWidth() }}
              redistributionPreferredSize={layout.treeWidth()}
              onSizeChangeEnd={layout.setTreeWidth}
              hidden={() =>
                props.narrow() || (!treeVisible() && !treePresent())
              }
              persistent
            >
              <Show when={!props.narrow()}>
                <CollapseTransition
                  open={treeVisible()}
                  axis="width"
                  container={() => treePanel() ?? undefined}
                  expandedSize={expandedTreeSize()}
                  companions={companions}
                  onPresenceChange={setTreePresent}
                  captureController={(controller) => {
                    finishTreeMotion = controller.finish;
                  }}
                >
                  <div ref={setWideDock} class="size-full" />
                </CollapseTransition>
              </Show>
            </Resize.Panel>
            <Resize.Panel id="changes-diff" index={1} minSize={240}>
              <div
                ref={diffBody}
                class="flex size-full min-w-0 flex-col overflow-hidden @container/changes-diff"
              >
                <ChangesControls
                  narrow={props.narrow()}
                  drawerOpen={props.drawerOpen()}
                />
                <Switch>
                  <Match when={model.patchStatus() === 'error'}>
                    <div class="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                      <WarningCircleIcon class="size-6 text-ink-placeholder" />
                      <p class="text-sm font-medium text-ink">
                        The diff could not be loaded
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={model.retryPatch}
                      >
                        Try again
                      </Button>
                    </div>
                  </Match>
                  <Match when={model.patch() !== undefined}>
                    <DiffView.Stack
                      header={(entry) => (
                        <>
                          <DiffView.CollapseButton />
                          <DiffView.FilePath />
                          <DiffView.FileCounts />
                          <CopyFilePathButton
                            path={entry.file.path}
                            onCopy={copyPath}
                          />
                        </>
                      )}
                      annotations={notes.annotations}
                      renderAnnotation={notes.renderAnnotation}
                      selection={notes.selection}
                      onSelectLines={notes.onSelectLines}
                    />
                  </Match>
                  <Match when={true}>
                    <div class="flex flex-1 items-center justify-center gap-2 text-xs text-ink-placeholder">
                      <CircleNotchIcon class="size-4 animate-spin" />
                      Loading the diff…
                    </div>
                  </Match>
                </Switch>
              </div>
            </Resize.Panel>
          </Resize.Zone>
          <Show when={props.narrow()}>
            <ChangesTreeDrawer
              open={props.drawerOpen()}
              width={drawerWidth()}
              onClose={props.closeDrawer}
              dock={setDrawerDock}
            />
          </Show>
        </div>
      </div>
    </Panel.Body>
  );
}

/** Every state without files to show, each explained in the body. */
function ChangesNotices() {
  const { model } = useAgentChanges();
  const state = model.state;
  const showsChangeset = () => model.changeset() !== undefined;
  const range = () => {
    const current = model.changeset();
    return current ? describeRange(current) : undefined;
  };
  return (
    <Panel.Body class="flex flex-col">
      <CaptureBanners />
      <Switch>
        <Match when={state().kind === 'loading'}>
          <ChangesNotice
            icon={<CircleNotchIcon class="animate-spin" />}
            title="Loading changes"
          />
        </Match>
        <Match when={state().kind === 'load_error'}>
          <ChangesNotice
            icon={<WarningCircleIcon />}
            title="The changes could not be loaded"
            detail="The changes service did not answer. Try again in a moment."
            onRefresh={() => void model.refresh()}
            refreshing={model.refreshing()}
          />
        </Match>
        <Match when={stateOf(state(), 'not_ready')}>
          {(current) => (
            <ChangesNotice
              title="Pull request changes unavailable"
              detail={current().message}
              onRefresh={() => void model.refresh()}
              refreshing={model.refreshing()}
            />
          )}
        </Match>
        <Match when={state().kind === 'none'}>
          <ChangesNotice
            title="No pull request changes loaded"
            detail="Link a GitHub pull request, then refresh to review its changes."
            onRefresh={() => void model.refresh()}
            refreshing={model.refreshing()}
          />
        </Match>
        <Match when={showsChangeset() ? undefined : stateOf(state(), 'failed')}>
          {(current) => (
            <ChangesNotice
              icon={<WarningCircleIcon />}
              title="The changes could not be captured"
              detail={current().message}
              onRefresh={() => void model.refresh()}
              refreshing={model.refreshing()}
            />
          )}
        </Match>
        <Match when={state().kind === 'capturing' && !showsChangeset()}>
          <ChangesNotice
            icon={<CircleNotchIcon class="animate-spin" />}
            title="Capturing the changes"
            detail="Reading the linked pull request from GitHub."
          />
        </Match>
        <Match when={showsChangeset()}>
          <ChangesNotice
            title="No changes"
            detail={
              range()
                ? `Nothing differs between ${range()}.`
                : 'The pull request has no changed files.'
            }
            onRefresh={() => void model.refresh()}
            refreshing={model.refreshing()}
          />
        </Match>
      </Switch>
    </Panel.Body>
  );
}

export function ChangesPane(props: { fullWidth?: boolean }) {
  const { layout, model, review, diffStyle, context, changeCounts } =
    useAgentChanges();
  const collapse: DiffCollapse = {
    isCollapsed: review.isCollapsed,
    toggle: review.toggleCollapsed,
    toggleAll: review.toggleAllCollapsed,
    anyExpanded: review.anyExpanded,
  };
  const range = () => {
    const current = model.changeset();
    return current ? describeRange(current) : undefined;
  };
  const showsFiles = () =>
    model.changeset() !== undefined && model.files().length > 0;

  return (
    <DiffView.Root
      files={model.files()}
      patch={model.patch() ?? ''}
      diffStyle={isTouchDevice() ? 'unified' : diffStyle()}
      collapse={collapse}
      active={review.active()}
    >
      <Panel
        hideBorder
        class="rounded-none @container/changes-pane"
        role="region"
        aria-label="Changes"
      >
        <Panel.Header class="gap-1 py-1">
          <div
            class="flex min-w-0 flex-1 items-center gap-1"
            role="group"
            aria-label="Changes controls"
          >
            <ChangesHeader
              mobile={isTouchDevice()}
              spotlit={!!props.fullWidth || layout.layout() === 'full'}
              range={range()}
              pullRequestUrl={context.host.pullRequestUrl()}
              pullRequestTitle={context.host.pullRequestTitle?.()}
              changeCounts={changeCounts()}
              onViewPullRequest={() => {
                const url = context.host.pullRequestUrl();
                if (url) context.host.openExternal(url);
              }}
              onSpotlight={props.fullWidth ? undefined : layout.spotlight}
              onClose={layout.close}
            />
          </div>
        </Panel.Header>
        <Show when={showsFiles()} fallback={<ChangesNotices />}>
          <ChangesBody />
        </Show>
      </Panel>
    </DiffView.Root>
  );
}
