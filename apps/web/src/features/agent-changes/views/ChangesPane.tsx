/**
 * The Changes pane: header, the capture notices, and the file tree beside
 * the diff stack, with review notes hung under their lines. Reads the
 * controller and composes the generic tree and diff view from it.
 */

import {
  type DiffCollapse,
  DiffCounts,
  DiffView,
  StatusLetter,
} from '@app/components/diff-view';
import { FileTree } from '@app/components/file-tree';
import CircleNotchIcon from '@phosphor/circle-notch.svg';
import CopyIcon from '@phosphor/copy.svg';
import FileIcon from '@phosphor/file.svg';
import WarningCircleIcon from '@phosphor/warning-circle.svg';
import { Button } from '@ui';
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
import { composingAtLine, noteLines, notesAtLine } from '../core/review-notes';

/** The tree beside the stack, both over the changeset's files. */
function ChangesBody() {
  const { model, review, diffStyle, copyPath, context } = useAgentChanges();
  const collapse: DiffCollapse = {
    isCollapsed: review.isCollapsed,
    toggle: review.toggleCollapsed,
    toggleAll: review.toggleAllCollapsed,
    anyExpanded: review.anyExpanded,
  };
  return (
    <DiffView.Root
      files={model.files()}
      patch={model.patch() ?? ''}
      diffStyle={diffStyle()}
      collapse={collapse}
      active={review.active()}
    >
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-edge-muted px-2">
        <span class="flex-1" />
        <DiffView.CollapseAll />
      </div>
      <Show when={model.changeset()?.truncated}>
        <CaptureBanner
          tone="failure"
          text="Some diffs were left out to fit the size budget; the file list is complete."
        />
      </Show>
      <div class="flex min-h-0 flex-1">
        <div class="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-edge-muted p-2 max-md:w-48">
          <div class="flex h-8 shrink-0 items-center px-2 text-xs font-medium text-ink-extra-muted">
            {describeFileCount(model.files().length)}
          </div>
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
              annotations={(entry) =>
                noteLines(review.notes(), review.composing(), entry.file.path)
              }
              renderAnnotation={(entry, key) => (
                <NoteAnnotation
                  notes={notesAtLine(review.notes(), entry.file.path, key)}
                  composing={composingAtLine(
                    review.composing(),
                    entry.file.path,
                    key
                  )}
                  onAdd={review.addNote}
                  onCancel={review.cancelNote}
                  onRemove={review.removeNote}
                />
              )}
              selection={review.composing}
              onSelectLines={context.host.agent ? review.openNote : undefined}
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
    </DiffView.Root>
  );
}

export function ChangesPane() {
  const controller = useAgentChanges();
  const { layout, model, context, diffStyle, setDiffStyle } = controller;
  const state = model.state;
  const changeset = model.changeset;
  /** The state narrowed to one kind, for `<Match>` to hand its fields down. */
  const stateOf = <K extends ChangesState['kind']>(kind: K) => {
    const current = state();
    return current.kind === kind
      ? (current as Extract<ChangesState, { kind: K }>)
      : undefined;
  };
  const range = () => {
    const current = changeset();
    return current ? describeRange(current) : undefined;
  };
  const hasFiles = () => model.files().length > 0;
  const showsChangeset = () => changeset() !== undefined;

  return (
    <section
      class="relative flex h-full min-w-0 flex-col bg-panel"
      aria-label="Changes"
    >
      <ChangesHeader
        spotlit={layout.layout() === 'full'}
        range={range()}
        diffStyle={diffStyle()}
        onDiffStyle={setDiffStyle}
        pullRequestUrl={context.host.pullRequestUrl()}
        onViewPullRequest={() => {
          const url = context.host.pullRequestUrl();
          if (url) context.host.openExternal(url);
        }}
        refreshing={model.refreshing() || state().kind === 'capturing'}
        onRefresh={() => void model.refresh()}
        onBack={layout.backToSplit}
        onSpotlight={layout.spotlight}
        onClose={layout.close}
      />
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
        <Match when={stateOf('not_ready')}>
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
        <Match when={showsChangeset() ? undefined : stateOf('failed')}>
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
          <Show when={state().kind === 'capturing'}>
            <CaptureBanner
              tone="progress"
              text="Capturing the changes again…"
            />
          </Show>
          <Show when={stateOf('failed')}>
            {(current) => (
              <CaptureBanner
                tone="failure"
                text={`The last capture failed: ${current().message}`}
                onRefresh={() => void model.refresh()}
                refreshing={model.refreshing()}
              />
            )}
          </Show>
          <Show
            when={hasFiles()}
            fallback={
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
            }
          >
            <ChangesBody />
          </Show>
        </Match>
      </Switch>
    </section>
  );
}
