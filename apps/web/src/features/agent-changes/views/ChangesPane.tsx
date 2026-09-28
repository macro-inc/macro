/**
 * The Changes pane: a title row with the pane's own controls, a toolbar for
 * the diffs, the capture notices, and the file tree beside the diff stack
 * with review notes hung under their lines. Reads the controller and
 * composes the generic tree and diff view from it.
 */

import {
  createDiffComments,
  type DiffCollapse,
  DiffCounts,
  DiffView,
  StatusLetter,
} from '@app/components/diff-view';
import ArrowsClockwiseIcon from '@phosphor/arrows-clockwise.svg';
import CircleNotchIcon from '@phosphor/circle-notch.svg';
import CopyIcon from '@phosphor/copy.svg';
import FileIcon from '@phosphor/file.svg';
import SidebarIcon from '@phosphor/sidebar-simple.svg';
import WarningCircleIcon from '@phosphor/warning-circle.svg';
import { Button, cn, Panel } from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { FileTree } from '@ui/components/FileTree';
import { Match, Show, Switch } from 'solid-js';
import { ChangesHeader } from '../components/ChangesHeader';
import { CaptureBanner, ChangesNotice } from '../components/ChangesNotice';
import { NoteAnnotation } from '../components/NoteAnnotation';
import { useAgentChanges } from '../context/agent-changes-controller';
import {
  type ChangesState,
  describeFileCount,
  describeRange,
} from '../core/changeset';

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

/** The toolbar and the tree beside the stack, both over the changeset's files. */
function ChangesBody() {
  const { model, review, layout, diffStyle, setDiffStyle, copyPath, context } =
    useAgentChanges();
  const collapse: DiffCollapse = {
    isCollapsed: review.isCollapsed,
    toggle: review.toggleCollapsed,
    toggleAll: review.toggleAllCollapsed,
    anyExpanded: review.anyExpanded,
  };
  const refreshing = () =>
    model.refreshing() || model.state().kind === 'capturing';
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
  return (
    <DiffView.Root
      files={model.files()}
      patch={model.patch() ?? ''}
      diffStyle={diffStyle()}
      collapse={collapse}
      active={review.active()}
    >
      <Panel.Toolbar class="gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          label={layout.treeOpen() ? 'Hide file tree' : 'Show file tree'}
          aria-expanded={layout.treeOpen()}
          onClick={layout.toggleTree}
        >
          <SidebarIcon />
        </Button>
        <span class="truncate px-1 text-xs text-ink-subtle">
          {describeFileCount(model.files().length)}
        </span>
        <span class="flex-1" />
        <DiffView.StyleToggle
          value={diffStyle()}
          onChange={setDiffStyle}
          class="max-md:hidden"
        />
        <DiffView.CollapseAll />
        <Button
          variant="ghost"
          size="icon-sm"
          label="Refresh pull request changes"
          disabled={refreshing()}
          onClick={() => void model.refresh()}
        >
          <ArrowsClockwiseIcon class={cn(refreshing() && 'animate-spin')} />
        </Button>
      </Panel.Toolbar>
      <Panel.Body class="flex flex-col">
        <CaptureBanners />
        <Show when={model.changeset()?.truncated}>
          <CaptureBanner
            tone="failure"
            text="Some diffs were left out to fit the size budget; the file list is complete."
          />
        </Show>
        <div class="flex min-h-0 flex-1">
          <CollapseTransition open={layout.treeOpen()} axis="width">
            <div class="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-edge-muted p-2 max-md:w-48">
              <FileTree.Root
                aria-label="Changed files"
                items={model.files()}
                path={(file) => file.path}
                selected={review.active()}
                onSelect={(file) => review.activate(file.path)}
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
          </CollapseTransition>
          <Switch>
            <Match when={model.patchStatus() === 'error'}>
              <div class="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                <WarningCircleIcon class="size-6 text-ink-placeholder" />
                <p class="text-sm font-medium text-ink">
                  The diff could not be loaded
                </p>
                <Button variant="outline" size="sm" onClick={model.retryPatch}>
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
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      tooltip="Copy path"
                      onClick={() => copyPath(entry.file.path)}
                    >
                      <CopyIcon />
                    </Button>
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
      </Panel.Body>
    </DiffView.Root>
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

export function ChangesPane() {
  const { layout, model, context } = useAgentChanges();
  const range = () => {
    const current = model.changeset();
    return current ? describeRange(current) : undefined;
  };
  const showsFiles = () =>
    model.changeset() !== undefined && model.files().length > 0;

  return (
    <Panel class="rounded-none" role="region" aria-label="Changes">
      <Panel.Header class="gap-1.5">
        <ChangesHeader
          spotlit={layout.layout() === 'full'}
          range={range()}
          pullRequestUrl={context.host.pullRequestUrl()}
          onViewPullRequest={() => {
            const url = context.host.pullRequestUrl();
            if (url) context.host.openExternal(url);
          }}
          onSpotlight={layout.spotlight}
          onClose={layout.close}
        />
      </Panel.Header>
      <Show when={showsFiles()} fallback={<ChangesNotices />}>
        <ChangesBody />
      </Show>
    </Panel>
  );
}
