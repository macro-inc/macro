import { getDisplayName } from '@core/user/displayName';
import { tryMacroId } from '@core/user/macroId';
import { fireAndForget } from '@core/util/fireAndForget';
import { formatRelativeDate } from '@core/util/time';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import DotsIcon from '@icon/system/regular/dots-three.svg';
import ShareIcon from '@icon/system/regular/share-network.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import { Button, cn, Dropdown, ToggleSwitch, Tooltip } from '@ui';
import { type Accessor, createSignal, Match, Show, Switch } from 'solid-js';
import { RoutineEditor } from '../components/routine-editor';
import { RoutineRunButton } from '../components/routine-run-button';
import type { RoutineDetailSlots } from '../context/routine-slots';
import type { RoutineDetailSource } from '../context/routine-sources';
import type { HistoryRecord, HistoryResource } from '../core/history';
import {
  createEmptyDraft,
  draftPrompt,
  getErrorMessage,
  withDraftSteps,
} from '../core/routine-draft';
import { stepsNeedEvent } from '../core/routine-steps';
import {
  describeHistoryStep,
  latestStepRun,
  stepsForRun,
} from '../core/step-history';
import {
  createRoutineDetail,
  RoutineConflictError,
} from '../primitives/routine-detail';
import { RoutineHistory } from './routine-history';
import { routineSections } from './routine-sections';

/** When the latest run started: its time today, else its day. */
function lastRunTime(records: readonly HistoryRecord[]): string | undefined {
  const latest = records
    .map((record) => (record.startedAt ? new Date(record.startedAt) : null))
    .filter(
      (date): date is Date => date !== null && !Number.isNaN(date.getTime())
    )
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (!latest) return undefined;
  return new Date().toDateString() === latest.toDateString()
    ? latest.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })
    : formatRelativeDate(latest);
}

/** Whether the routine's edits have reached the server, and if not, why. */
function SaveState(props: {
  saving: boolean;
  failed: boolean;
  /** Why edits are held back from saving. */
  invalid?: string;
}) {
  const label = () =>
    props.failed
      ? 'Not saved'
      : props.invalid
        ? 'Not saved: fix the routine'
        : props.saving
          ? 'Saving…'
          : 'Saved';
  return (
    <span
      title={props.invalid}
      class={cn(
        'px-1.5 text-xs @max-[600px]/routine:hidden',
        props.failed || props.invalid ? 'text-failure' : 'text-ink-extra-muted'
      )}
    >
      <span aria-hidden="true">{label()}</span>
      {/* Screen readers hear where saving settled, not every keystroke. */}
      <span role="status" class="sr-only">
        {props.saving ? '' : label()}
      </span>
    </span>
  );
}

export function RoutineDetailView(props: {
  source: RoutineDetailSource;
  userId: Accessor<string | undefined>;
  defaultModel: string;
  /** Decisions are answered by the classifier behind trigger conditions. */
  decisionsEnabled: boolean;
  slots: RoutineDetailSlots;
  initialTab?: 'settings' | 'history';
  onRename(name: string): void;
  onBack(): void;
  onDelete(): void;
  onCopyPrompt(prompt: string): Promise<void>;
  onShare?(): void;
  /** Opens an agent conversation about this routine. */
  onCompose?(): void;
  onOpenTemplate?(templateId: string): void;
  onOpenRun(resource: HistoryResource, newSplit: boolean): void;
}) {
  const connectedApps = props.slots.createConnectedApps();
  const {
    schedule,
    state,
    setState,
    isOwned,
    isRunning,
    isActive,
    editorVersion,
    formError,
    autosave,
    initializeDraft,
    nextRun,
    runDisabled,
    activationDisabled,
    runNow,
  } = createRoutineDetail(props.source, {
    userId: props.userId,
    connectedApps,
    onRename: (name) => props.onRename(name),
  });
  const [tab, setTab] = createSignal(props.initialTab ?? 'settings');
  const [showRun, setShowRun] = createSignal(true);
  const back = () => props.onBack();
  const prompt = () => {
    const draft = state();
    return draft ? draftPrompt(draft) : '';
  };
  const copyPrompt = async () => {
    if (prompt()) await props.onCopyPrompt(prompt());
  };
  /** Why the Enabled switch can't change right now. */
  const activationHint = () => {
    if (!activationDisabled() || !isOwned()) return undefined;
    if (isRunning()) return 'Wait for the current run to finish';
    if (nextRun() === 'No upcoming runs')
      return 'Update the schedule before turning it on';
    return 'Fix the routine before turning it on';
  };
  /** Manual runs have no triggering item for steps to read. */
  const needsEvent = () => {
    const steps = state()?.steps;
    return steps !== undefined && stepsNeedEvent(steps);
  };
  const runHint = () =>
    needsEvent()
      ? 'This routine acts on the item that triggers it, so it runs on activity'
      : undefined;
  return (
    <Show
      when={schedule()}
      fallback={
        <div class="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-sm text-ink-muted">
          <Switch fallback={<>Routine not found.</>}>
            <Match when={props.source.error() && !schedule()}>
              Unable to load routine. Please try again.
            </Match>
            <Match when={props.source.loading()}>Loading…</Match>
          </Switch>
        </div>
      }
    >
      {(routine) => (
        <RoutineEditor
          {...routineSections({
            draft: state,
            onChange: setState,
            withSteps: withDraftSteps,
            version: editorVersion,
            slots: props.slots,
            defaultModel: props.defaultModel,
            decisionsEnabled: props.decisionsEnabled,
            connected: connectedApps,
            runsAs: () =>
              routine().ownerId === props.userId()
                ? 'You'
                : getDisplayName(tryMacroId(routine().ownerId)) || 'Owner',
            runsAsDescription: 'Steps and AI act with the owner’s access.',
            lastRun: () =>
              latestStepRun(props.source.history(), routine().revision),
            showRun,
            onShowRun: setShowRun,
            unsupported: (
              <p class="text-sm text-ink-muted">
                This routine has an unsupported task configuration.
              </p>
            ),
          })}
          draft={
            state() ?? {
              ...createEmptyDraft(props.defaultModel),
              name: routine().name,
            }
          }
          onChange={setState}
          disabled={!isOwned() || isRunning() || !state()}
          tab={isOwned() ? tab() : 'settings'}
          showHistory={isOwned()}
          onTab={setTab}
          onBack={back}
          runCount={props.source.history().length}
          headerActions={
            isOwned() && (
              <>
                <Show when={state()}>
                  <SaveState
                    saving={
                      autosave.saving() || (autosave.dirty() && !formError())
                    }
                    failed={Boolean(autosave.error())}
                    invalid={
                      autosave.dirty() && !autosave.saving()
                        ? (formError() ?? undefined)
                        : undefined
                    }
                  />
                </Show>
                <RoutineRunButton
                  enabled={isActive()}
                  runDisabled={runDisabled() || needsEvent()}
                  runHint={runHint()}
                  activationDisabled={activationDisabled()}
                  copyDisabled={!prompt()}
                  onRun={runNow}
                  onEnabled={(enabled) => props.source.setEnabled(enabled)}
                  onCopyPrompt={() => fireAndForget(copyPrompt(), 'routines')}
                />
              </>
            )
          }
          actions={
            isOwned() && (
              <Dropdown placement="bottom-start">
                <Dropdown.Trigger
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Routine actions"
                >
                  <DotsIcon class="size-4" />
                </Dropdown.Trigger>
                <Dropdown.Content portalScope="local">
                  <Dropdown.Group>
                    <Dropdown.Item
                      disabled={!state() || props.source.duplicationPending()}
                      onSelect={() => props.source.duplicate()}
                    >
                      <CopyIcon class="size-4" />
                      Duplicate
                    </Dropdown.Item>
                    <Show when={props.onShare}>
                      <Dropdown.Item onSelect={props.onShare}>
                        <ShareIcon class="size-4" />
                        Share
                      </Dropdown.Item>
                    </Show>
                  </Dropdown.Group>
                  <Dropdown.Separator />
                  <Dropdown.Group>
                    <Dropdown.Item
                      class="text-failure-ink"
                      onSelect={props.onDelete}
                    >
                      <TrashIcon class="size-4" />
                      Delete
                    </Dropdown.Item>
                  </Dropdown.Group>
                </Dropdown.Content>
              </Dropdown>
            )
          }
          nextRun={nextRun()}
          metaAction={
            isOwned() && (
              <Show when={props.onCompose}>
                {(compose) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => compose()()}
                  >
                    <SparkleIcon class="size-3.5" />
                    Compose with agent
                  </Button>
                )}
              </Show>
            )
          }
          meta={
            <>
              <Tooltip
                label={activationHint() ?? ''}
                disabled={!activationHint()}
              >
                <ToggleSwitch
                  class="flex-row-reverse"
                  label="Enabled"
                  labelClass="text-sm font-medium text-ink"
                  checked={isActive()}
                  disabled={activationDisabled()}
                  onChange={(enabled) => props.source.setEnabled(enabled)}
                />
              </Tooltip>
              <span>
                Owned by{' '}
                <span class="font-medium text-ink">
                  {routine().ownerId === props.userId()
                    ? 'You'
                    : getDisplayName(tryMacroId(routine().ownerId)) ||
                      'Someone'}
                </span>
              </span>
              <Show when={isOwned() && lastRunTime(props.source.history())}>
                {(at) => (
                  <>
                    <span aria-hidden="true" class="text-ink-extra-muted">
                      ·
                    </span>
                    <span>Last run {at()}</span>
                  </>
                )}
              </Show>
              {/* Touch has no tooltips: say why a control is off. */}
              <Show when={activationHint() ?? runHint()}>
                {(hint) => (
                  <span class="hidden basis-full text-xs text-ink-muted touch:block">
                    {hint()}
                  </span>
                )}
              </Show>
              <Show when={props.onOpenTemplate && routine().templateId}>
                {(templateId) => (
                  <>
                    <span aria-hidden="true" class="text-ink-extra-muted">
                      ·
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => props.onOpenTemplate?.(templateId())}
                    >
                      From a template
                      <ArrowUpRightIcon class="size-3" />
                    </Button>
                  </>
                )}
              </Show>
            </>
          }
          feedback={
            <>
              <Show when={autosave.error()}>
                <p role="alert" class="text-sm text-failure">
                  Changes not saved. {getErrorMessage(autosave.error())}
                  <button
                    type="button"
                    class="ml-2 underline"
                    onClick={() => {
                      if (autosave.error() instanceof RoutineConflictError) {
                        autosave.cancel();
                        initializeDraft();
                      } else autosave.retry();
                    }}
                  >
                    {autosave.error() instanceof RoutineConflictError
                      ? 'Reload latest'
                      : 'Retry save'}
                  </button>
                </p>
              </Show>
              <Show when={formError()}>
                {(message) => (
                  <p role="alert" class="text-sm text-failure">
                    {message()}
                  </p>
                )}
              </Show>
              <Show when={isRunning()}>
                <p class="text-xs text-ink-muted">
                  Running. Configuration cannot be changed while running.
                </p>
              </Show>
            </>
          }
          history={
            <>
              <Show when={props.source.historyError()}>
                <p role="alert" class="px-4 py-3 text-sm text-failure">
                  Could not load run history.{' '}
                  <button
                    class="underline"
                    onClick={() =>
                      fireAndForget(props.source.refreshHistory(), 'routines')
                    }
                  >
                    Retry
                  </button>
                </p>
              </Show>
              <RoutineHistory
                records={props.source.history()}
                describeStep={(step, record) =>
                  describeHistoryStep(
                    step,
                    stepsForRun(record, routine()),
                    // Runs recorded before step kinds were stored read
                    // them from the routine as it is now.
                    state()?.steps
                  )
                }
                isPending={props.source.historyLoading()}
                createChatMetadata={props.slots.createChatMetadata}
                createAgentMetadata={props.slots.createAgentMetadata}
                onOpen={props.onOpenRun}
              />
            </>
          }
        />
      )}
    </Show>
  );
}
