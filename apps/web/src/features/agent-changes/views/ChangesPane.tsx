/**
 * The Changes pane: header, review bar, file tree, the stack of file cards,
 * and the pull request sheet over it all. Reads the controller and hands
 * resolved values to the components.
 */

import CircleNotchIcon from '@phosphor/circle-notch.svg';
import WarningCircleIcon from '@phosphor/warning-circle.svg';
import { Button } from '@ui';
import {
  createEffect,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { ChangesHeader } from '../components/ChangesHeader';
import { CaptureBanner, ChangesNotice } from '../components/ChangesNotice';
import { FileCard } from '../components/FileCard';
import { FileTree } from '../components/FileTree';
import { PierreFileDiff } from '../components/PierreFileDiff';
import { PullRequestSheet } from '../components/PullRequestSheet';
import { ReviewBar } from '../components/ReviewBar';
import { useAgentChanges } from '../context/agent-changes-controller';
import { type ChangesState, describeRange } from '../core/changeset';
import type { FileDiffEntry } from '../core/patch';
import { notesForFile } from '../core/review-notes';
import { createThemeType } from '../primitives/create-theme-type';

const FLASH_MS = 900;

function DiffStack(props: { entries: FileDiffEntry[] }) {
  const { review, diffStyle, copyPath } = useAgentChanges();
  const themeType = createThemeType();
  const cards = new Map<string, HTMLElement>();
  const [flashing, setFlashing] = createSignal<string>();

  // Jumping from the tree is a DOM concern: scroll the card in and flash it.
  createEffect(
    on(
      review.active,
      (path) => {
        if (!path) return;
        cards.get(path)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        setFlashing(path);
        const timer = setTimeout(() => setFlashing(undefined), FLASH_MS);
        onCleanup(() => clearTimeout(timer));
      },
      { defer: true }
    )
  );

  return (
    <div class="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto scroll-smooth px-3.5 pt-3 pb-24 motion-reduce:scroll-auto">
      <For each={props.entries}>
        {(entry) => {
          const path = () => entry.file.path;
          const composing = () => {
            const anchor = review.composing();
            return anchor?.path === path() ? anchor : undefined;
          };
          return (
            <FileCard
              entry={entry}
              collapsed={review.isCollapsed(path())}
              viewed={review.isViewed(path())}
              flash={flashing() === path()}
              onToggleCollapsed={() => review.toggleCollapsed(path())}
              onToggleViewed={() => review.toggleViewed(path())}
              onCopyPath={() => copyPath(path())}
              ref={(element) => {
                cards.set(path(), element);
                onCleanup(() => cards.delete(path()));
              }}
              body={
                <Show when={entry.diff}>
                  {(diff) => (
                    <PierreFileDiff
                      path={path()}
                      diff={diff()}
                      diffStyle={diffStyle()}
                      themeType={themeType()}
                      notes={notesForFile(review.notes(), path())}
                      composing={composing()}
                      onOpenNote={review.openNote}
                      onCancelNote={review.cancelNote}
                      onAddNote={review.addNote}
                      onRemoveNote={review.removeNote}
                    />
                  )}
                </Show>
              }
            />
          );
        }}
      </For>
    </div>
  );
}

export function ChangesPane() {
  const controller = useAgentChanges();
  const { layout, model, review, pullRequest, diffStyle, setDiffStyle } =
    controller;
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
        spotlit={layout.layout() === 'changes-only'}
        range={range()}
        diffStyle={diffStyle()}
        onDiffStyle={setDiffStyle}
        pullRequest={{
          linkedUrl: pullRequest.linkedUrl(),
          busy: pullRequest.busy(),
          canCompare: pullRequest.compareUrl() !== undefined,
          enabled: hasFiles(),
          onAction: pullRequest.start,
          onView: pullRequest.view,
        }}
        refreshing={model.refreshing() || state().kind === 'capturing'}
        onRefresh={() => void model.refresh()}
        onBack={layout.backToSplit}
        onSpotlight={layout.spotlight}
        onClose={layout.close}
      />
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
        <Match when={stateOf('unsupported')}>
          {(current) => (
            <ChangesNotice
              title="This session does not report its changes"
              detail={current().message}
            />
          )}
        </Match>
        <Match when={stateOf('not_ready')}>
          {(current) => (
            <ChangesNotice
              title="Nothing to compare yet"
              detail={current().message}
              onRefresh={() => void model.refresh()}
              refreshing={model.refreshing()}
            />
          )}
        </Match>
        <Match when={state().kind === 'none'}>
          <ChangesNotice
            title="No changes captured yet"
            detail="Changes are captured when the agent finishes a turn. Capture them now to see what it has done so far."
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
            detail="Reading the diff from the agent's workspace."
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
                    : 'The agent has not changed any files.'
                }
                onRefresh={() => void model.refresh()}
                refreshing={model.refreshing()}
              />
            }
          >
            <ReviewBar
              viewed={review.progress().viewed}
              total={review.progress().total}
              anyExpanded={review.anyExpanded()}
              allViewed={review.allViewed()}
              onToggleCollapsed={review.toggleAllCollapsed}
              onToggleViewed={review.toggleAllViewed}
            />
            <Show when={changeset()?.truncated}>
              <CaptureBanner
                tone="failure"
                text="Some diffs were left out to fit the size budget; the file list is complete."
              />
            </Show>
            <div class="flex min-h-0 flex-1">
              <FileTree
                nodes={model.tree()}
                fileCount={model.files().length}
                viewed={review.viewed()}
                active={review.active()}
                onSelect={review.activate}
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
                <Match when={model.entries()}>
                  {(entries) => <DiffStack entries={entries()} />}
                </Match>
                <Match when={true}>
                  <div class="flex flex-1 items-center justify-center gap-2 text-xs text-ink-placeholder">
                    <CircleNotchIcon class="size-4 animate-spin" />
                    Loading the diff…
                  </div>
                </Match>
              </Switch>
            </div>
          </Show>
        </Match>
      </Switch>
      <Show when={pullRequest.sheet().kind !== 'closed' && changeset()}>
        {(current) => (
          <PullRequestSheet
            sheet={pullRequest.sheet()}
            changeset={current()}
            onChange={pullRequest.updateForm}
            onRegenerate={pullRequest.regenerate}
            onSubmit={pullRequest.submit}
            onOpenCompare={() => pullRequest.start('github')}
            onOpenUrl={controller.context.host.openExternal}
            onClose={pullRequest.close}
          />
        )}
      </Show>
    </section>
  );
}
