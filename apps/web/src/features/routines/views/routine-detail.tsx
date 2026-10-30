import { SidePanel } from '@components/app/side-panel';
import {
  EntityMetadata,
  EntityMetadataRow,
} from '@components/app/side-panel/EntityMetadata';
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
import UserIcon from '@icon/system/regular/user.svg';
import { Button, Dropdown, ToggleSwitch } from '@ui';
import { type Accessor, createSignal, Match, Show, Switch } from 'solid-js';
import { ConnectionRows } from '../components/routine-connections';
import {
  RoutineEditor,
  RoutineSettingRow,
  RoutineSurface,
} from '../components/routine-editor';
import { RoutineRunButton } from '../components/routine-run-button';
import {
  RoutineSteps,
  RoutineStepsSummary,
} from '../components/routine-step-editor';
import type { RoutineDetailSlots } from '../context/routine-slots';
import type { RoutineDetailSource } from '../context/routine-sources';
import { DEFAULT_RUN_VISIBILITY } from '../core/draft';
import type { HistoryRecord, HistoryResource } from '../core/history';
import {
  createEmptyDraft,
  draftPrompt,
  draftSteps,
  getErrorMessage,
  withDraftSteps,
} from '../core/routine-draft';
import { firstAgent, stepsNeedEvent } from '../core/routine-steps';
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

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Runs in the last week by outcome, from the history loaded so far. */
function lastWeek(records: readonly HistoryRecord[], now = Date.now()) {
  const recent = records.filter((record) => {
    const started = record.startedAt ? Date.parse(record.startedAt) : NaN;
    return Number.isFinite(started) && now - started <= WEEK_MS;
  });
  if (!recent.length) return 'No runs';
  const skipped = recent.filter((record) => record.skipped).length;
  const failed = recent.filter(
    (record) => !record.skipped && record.success === false
  ).length;
  const ran = recent.length - skipped - failed;
  return `${ran} ran · ${skipped} skipped · ${failed} failed`;
}

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

/** Whether the routine's edits have reached the server. */
function SaveState(props: { saving: boolean; failed: boolean }) {
  return (
    <span
      role="status"
      class="px-1.5 text-xs text-ink-extra-muted @max-[600px]/routine:hidden"
    >
      <Switch fallback="Saved">
        <Match when={props.failed}>
          <span class="text-failure">Not saved</span>
        </Match>
        <Match when={props.saving}>Saving…</Match>
      </Switch>
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
    connectedApps: props.slots.createConnectedApps(),
    onRename: (name) => props.onRename(name),
  });
  const connectedApps = props.slots.createConnectedApps();
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
  /** Apps go to the routine's Ask AI step. */
  const hasAgent = () => {
    const draft = state();
    return !!draft && !!firstAgent(draftSteps(draft));
  };
  /** Manual runs have no triggering item for steps to read. */
  const needsEvent = () => {
    const steps = state()?.steps;
    return steps !== undefined && stepsNeedEvent(steps);
  };
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
                    saving={autosave.dirty() || autosave.saving()}
                    failed={Boolean(autosave.error())}
                  />
                </Show>
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
                <RoutineRunButton
                  enabled={isActive()}
                  runDisabled={runDisabled() || needsEvent()}
                  runHint={
                    needsEvent()
                      ? 'This routine acts on the item that triggers it, so it runs on activity'
                      : undefined
                  }
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
          details={
            <>
              <SidePanel.Footer>
                {/* The routine's facts on a card, like the page's sections. */}
                <RoutineSurface class="px-4 py-3">
                  <EntityMetadata
                    ownerId={routine().ownerId}
                    createdAt={routine().createdAt}
                  >
                    <EntityMetadataRow label="Next run">
                      {nextRun()}
                    </EntityMetadataRow>
                    <Show when={isOwned() && !props.source.historyLoading()}>
                      <EntityMetadataRow label="Last 7 days">
                        {lastWeek(props.source.history())}
                      </EntityMetadataRow>
                    </Show>
                  </EntityMetadata>
                </RoutineSurface>
              </SidePanel.Footer>
              <Show when={props.onOpenTemplate || props.onShare}>
                <SidePanel.Section
                  id="routine-template"
                  title="Template"
                  order={20}
                  defaultOpen
                >
                  <Show
                    when={props.onOpenTemplate && routine().templateId}
                    fallback={
                      <div class="flex items-center justify-between gap-2 text-xs text-ink-muted">
                        Not shared
                        <Show when={isOwned() && props.onShare}>
                          {(share) => (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => share()()}
                            >
                              Share…
                            </Button>
                          )}
                        </Show>
                      </div>
                    }
                  >
                    {(templateId) => (
                      <Button
                        variant="ghost"
                        size="sm"
                        class="-ml-2"
                        onClick={() => props.onOpenTemplate?.(templateId())}
                      >
                        Created from template
                        <ArrowUpRightIcon class="size-3.5" />
                      </Button>
                    )}
                  </Show>
                </SidePanel.Section>
              </Show>
            </>
          }
          nextRun={nextRun()}
          meta={
            <>
              <ToggleSwitch
                class="flex-row-reverse"
                label="Enabled"
                labelClass="text-sm font-medium text-ink"
                title={activationHint()}
                checked={isActive()}
                disabled={activationDisabled()}
                onChange={(enabled) => props.source.setEnabled(enabled)}
              />
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
            </>
          }
          connections={
            state() && (
              <ConnectionRows
                apps={state()?.apps ?? []}
                agent={hasAgent()}
                connected={connectedApps}
                onChange={(apps) =>
                  setState((current) => ({ ...current, apps }))
                }
                Picker={props.slots.Apps}
              />
            )
          }
          settings={
            <>
              <RoutineSettingRow
                label="Show runs in Home and Agents"
                description="Runs stay in this routine’s history unless shown."
              >
                <ToggleSwitch
                  size="md"
                  label="Show runs in Home and Agents"
                  labelClass="sr-only"
                  checked={
                    (state()?.runVisibility ?? DEFAULT_RUN_VISIBILITY) ===
                    'listed'
                  }
                  disabled={!isOwned() || !state()}
                  onChange={(listed) =>
                    setState((draft) => ({
                      ...draft,
                      runVisibility: listed ? 'listed' : 'unlisted',
                    }))
                  }
                />
              </RoutineSettingRow>
              <RoutineSettingRow
                label="Runs as"
                description="Steps and AI act with the owner’s access."
              >
                <span class="inline-flex items-center gap-1.5 text-sm text-ink">
                  <UserIcon class="size-4 text-ink-muted" />
                  {routine().ownerId === props.userId()
                    ? 'You'
                    : getDisplayName(tryMacroId(routine().ownerId)) || 'Owner'}
                </span>
              </RoutineSettingRow>
            </>
          }
          stepsAside={
            <Show when={state()}>
              {(draft) => (
                <RoutineStepsSummary
                  steps={draftSteps(draft())}
                  triggers={draft().triggers ?? []}
                  lastRun={latestStepRun(
                    props.source.history(),
                    routine().revision
                  )}
                  showRun={showRun()}
                  onShowRun={setShowRun}
                />
              )}
            </Show>
          }
          steps={
            <Show when={state()}>
              {(draft) => (
                <Show when={{ version: editorVersion() }} keyed>
                  <RoutineSteps
                    steps={draftSteps(draft())}
                    onChange={(steps) =>
                      setState((current) => withDraftSteps(current, steps))
                    }
                    triggers={draft().triggers ?? []}
                    defaultTarget={
                      firstAgent(draftSteps(draft()))?.target ?? {
                        kind: 'model',
                        model: props.defaultModel,
                      }
                    }
                    decisionsEnabled={props.decisionsEnabled}
                    slots={props.slots}
                    lastRun={latestStepRun(
                      props.source.history(),
                      routine().revision
                    )}
                    showRun={showRun()}
                  />
                </Show>
              )}
            </Show>
          }
          triggerContent={
            <Show
              when={state()}
              fallback={
                <p class="text-sm text-ink-muted">
                  This routine has an unsupported task configuration.
                </p>
              }
            >
              {(draft) => (
                <props.slots.Triggers
                  layout="rows"
                  triggers={draft().triggers ?? []}
                  onChange={(triggers) =>
                    setState((current) => ({ ...current, triggers }))
                  }
                />
              )}
            </Show>
          }
          hasTriggers={!state() || (state()?.triggers ?? []).length > 0}
          triggerAdd={
            <Show when={state()}>
              {(draft) => (
                <props.slots.Triggers
                  layout="add"
                  triggers={draft().triggers ?? []}
                  onChange={(triggers) =>
                    setState((current) => ({ ...current, triggers }))
                  }
                />
              )}
            </Show>
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
                  describeHistoryStep(step, stepsForRun(record, routine()))
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
