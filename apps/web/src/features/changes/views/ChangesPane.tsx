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
import { MobileDetailFrame } from '@components/app/mobile/MobileDetailFrame';
import { Resize } from '@core/component/Resize';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import * as Dialog from '@kobalte/core/dialog';
import ArrowsClockwiseIcon from '@phosphor/arrows-clockwise.svg';
import CircleNotchIcon from '@phosphor/circle-notch.svg';
import FileIcon from '@phosphor/file.svg';
import SidebarIcon from '@phosphor/sidebar-simple.svg';
import WarningCircleIcon from '@phosphor/warning-circle.svg';
import { Button, cn, Panel } from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { FileTree } from '@ui/components/FileTree';
import {
  type Accessor,
  createEffect,
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
import { useChanges } from '../context/changes-controller';
import {
  type ChangesState,
  describeFileCount,
  describeRange,
} from '../core/changeset';
import { createChangesNarrow } from '../primitives/create-changes-narrow';
import {
  MAX_TREE_WIDTH,
  MIN_TREE_WIDTH,
} from '../primitives/create-pane-layout';
import { createTreeLayout } from '../primitives/create-tree-layout';
import { ChangesTreeDrawer } from './ChangesTreeDrawer';

/** The state narrowed to one kind, for `<Match>` to hand its fields down. */
function stateOf<K extends ChangesState['kind']>(state: ChangesState, kind: K) {
  return state.kind === kind
    ? (state as Extract<ChangesState, { kind: K }>)
    : undefined;
}

/** Strips over the body: a failed refresh, and a capture over the changeset on screen. */
function CaptureBanners() {
  const { model } = useChanges();
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
  const { layout } = useChanges();
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
  const { model, layout, diffStyle, setDiffStyle } = useChanges();
  const refreshing = () =>
    model.refreshing() || model.state().kind === 'capturing';
  const treeVisible = () => !props.narrow && layout.treeOpen();
  return (
    <div
      class="flex min-w-0 shrink-0 items-center gap-1 px-3 pt-2 touch:absolute touch:inset-x-(--mobile-chrome-gutter) touch:top-(--mobile-detail-inset-top) touch:z-10 touch:h-10 touch:rounded-xl touch:glass touch:pt-0"
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
  const { model, layout } = useChanges();
  return (
    <div
      class="flex min-w-0 shrink-0 items-center justify-between gap-1 px-3 pt-2 pb-1 touch:pt-[calc(var(--mobile-detail-inset-top,0px)+0.5rem)]"
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
  const { model, review, layout, copyPath, context } = useChanges();
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
  const [wideDock, setWideDock] = createSignal<HTMLDivElement>();
  const [drawerDock, setDrawerDock] = createSignal<HTMLDivElement>();
  let treeBody!: HTMLDivElement;
  let diffBody: HTMLDivElement | undefined;
  const treeLayout = createTreeLayout({
    visible: treeVisible,
    width: layout.treeWidth,
    dock: wideDock,
    diff: () => diffBody,
  });
  // Construct once under Dialog.Root so directory state survives docking and hiding.
  const tree = (
    <div
      ref={treeBody}
      class="flex size-full min-w-0 flex-col overflow-hidden"
      inert={!(treeVisible() || (props.narrow() && props.drawerOpen()))}
      aria-hidden={!(treeVisible() || (props.narrow() && props.drawerOpen()))}
    >
      <ChangesTreeHeader narrow={props.narrow()} onClose={props.closeDrawer} />
      <div class="min-h-0 flex-1 overflow-y-auto p-2 pt-1 touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+0.5rem)]">
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
        treeLayout.finish();
        if (!props.narrow()) props.closeDrawer();
      },
      { defer: true }
    )
  );
  return (
    <Panel.Body class="relative flex min-h-0 flex-1 flex-col">
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
            element.addEventListener('pointerdown', treeLayout.settle, true);
            element.addEventListener('keydown', treeLayout.settle, true);
            onCleanup(() => {
              element.removeEventListener(
                'pointerdown',
                treeLayout.settle,
                true
              );
              element.removeEventListener('keydown', treeLayout.settle, true);
            });
          }}
        >
          <Resize.Zone
            direction="horizontal"
            gutter={1}
            class="overflow-hidden"
            captureResizeCtx={treeLayout.captureZone}
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
                props.narrow() || (!treeVisible() && !treeLayout.present())
              }
              persistent
            >
              <Show when={!props.narrow()}>
                <CollapseTransition
                  open={treeVisible()}
                  axis="width"
                  container={() => treeLayout.panel() ?? undefined}
                  expandedSize={treeLayout.expandedSize()}
                  companions={treeLayout.companions}
                  onPresenceChange={treeLayout.setPresent}
                  captureController={treeLayout.captureController}
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
                      contentClass="touch:pt-[calc(var(--mobile-detail-inset-top,0px)+3rem)] touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+1rem)]"
                      fileClass="touch:scroll-mt-[calc(var(--mobile-detail-inset-top,0px)+3rem)]"
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
              width={treeLayout.drawerWidth()}
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
  const { model } = useChanges();
  const state = model.state;
  const showsChangeset = () => model.changeset() !== undefined;
  const range = () => {
    const current = model.changeset();
    return current ? describeRange(current) : undefined;
  };
  return (
    <Panel.Body class="flex min-h-0 flex-1 flex-col touch:pt-(--mobile-detail-inset-top) touch:pb-(--mobile-content-inset-bottom)">
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
    useChanges();
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
        class="flex flex-col rounded-none @container/changes-pane"
        role="region"
        aria-label="Changes"
      >
        <MobileDetailFrame
          header={
            <div class="flex min-h-10 items-center gap-1 px-2 py-1 not-touch:border-b not-touch:border-edge-divider">
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
            </div>
          }
        >
          <Show when={showsFiles()} fallback={<ChangesNotices />}>
            <ChangesBody />
          </Show>
        </MobileDetailFrame>
      </Panel>
    </DiffView.Root>
  );
}
