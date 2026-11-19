import { t } from '@app/lib/i18n';
import { getDisplayName } from '@core/user/displayName';
import { tryMacroId } from '@core/user/macroId';
import { fireAndForget } from '@core/util/fireAndForget';
import { formatRelativeDate } from '@core/util/time';
import { formatDateAndTime } from '@entity';
import ShareIcon from '@icon/share.svg';
import ArrowClockwiseIcon from '@icon/system/regular/arrow-clockwise.svg';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import DotsIcon from '@icon/system/regular/dots-three.svg';
import LinkBreakIcon from '@icon/system/regular/link-break.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import { Button, cn, Dropdown, ToggleSwitch, Tooltip } from '@ui';
import {
  type Accessor,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { CodeReviewNotice } from '../components/routine-code-review';
import { RoutineEditor } from '../components/routine-editor';
import { RoutineRunButton } from '../components/routine-run-button';
import {
  RoutineSubRoutines,
  type SubRoutineItem,
} from '../components/routine-sub-routines';
import type { RoutineDetailSlots } from '../context/routine-slots';
import type { RoutineDetailSource } from '../context/routine-sources';
import { isClaimActive } from '../core/claim';
import type { SubRoutineDraft } from '../core/draft';
import type { HistoryRecord, HistoryResource } from '../core/history';
import { isFinished, type RoutineSnapshot } from '../core/routine';
import {
  createEmptyDraft,
  draftPrompt,
  getErrorMessage,
  withDraftSteps,
} from '../core/routine-draft';
import { describeTrigger } from '../core/routine-triggers';
import { type RunItem, runStartLine } from '../core/run-start';
import { describeHistoryStep, stepsForRun } from '../core/step-history';
import { labelledInputs } from '../core/sub-routines';
import {
  createRoutineDetail,
  RoutineConflictError,
} from '../primitives/routine-detail';
import { RoutineHistory } from './routine-history';
import { type CopySource, routineSections } from './routine-sections';

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

/** What a copy was given, in a line, as its definition labels the values. */
function copyValues(
  child: RoutineSnapshot,
  definitions: readonly SubRoutineDraft[]
): string | undefined {
  const copy = child.draft?.copy;
  if (!copy) return undefined;
  const definition = definitions.find((item) => item.name === copy.subRoutine);
  const values = labelledInputs(copy, definition);
  return values.length
    ? values.map((item) => `${item.label}: ${item.value}`).join(' · ')
    : undefined;
}

/** What a routine's runs created, as its page lists them, newest first. */
function subRoutineItems(
  children: readonly RoutineSnapshot[],
  finished: boolean,
  definitions: readonly SubRoutineDraft[]
): SubRoutineItem[] {
  const state = (child: RoutineSnapshot): SubRoutineItem['state'] => {
    if (finished) return 'finished';
    if (isClaimActive(child.claimedAt)) return 'running';
    return child.enabled ? 'active' : 'paused';
  };
  return children
    .filter((child) => isFinished(child) === finished)
    .toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((child) => ({
      id: child.id,
      name: child.name,
      when: (child.draft?.triggers ?? []).map(describeTrigger).join(' · '),
      values: copyValues(child, definitions),
      state: state(child),
    }));
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
  onActionsOpenChange(open: boolean): void;
  onCopyPrompt(prompt: string): Promise<void | boolean>;
  onShare?(): void;
  onStopSharing?(): void;
  onRetrySharing?(): void;
  stopSharingPending?: boolean;
  appearanceMenu?: JSX.Element;
  identityIcon?: JSX.Element;
  /** Opens an agent conversation about this routine. */
  onCompose?(): void;
  onOpenTemplate?(templateId: string): void;
  /** Opens another routine: one this routine created, or its creator. */
  onOpenRoutine(id: string): void;
  onOpenRun(resource: HistoryResource, newSplit: boolean): void;
  /** Opens the item an event run was about. */
  onOpenItem?(item: RunItem, newSplit: boolean): void;
}) {
  const {
    schedule,
    connectedApps,
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
    approvalDisabled,
    approveCodeUpdate,
    runNow,
  } = createRoutineDetail(props.source, {
    userId: props.userId,
    appChecks: props.slots,
    onRename: (name) => props.onRename(name),
  });
  const [tab, setTab] = createSignal(props.initialTab ?? 'settings');
  const back = () => props.onBack();
  const prompt = () => {
    const draft = state();
    return draft ? draftPrompt(draft) : '';
  };
  const copyPrompt = async () => {
    if (!prompt()) return false;
    return props.onCopyPrompt(prompt());
  };
  /** On a sub-routine's page: its parent's definition, which it runs. */
  const copySource = (): CopySource | undefined => {
    const copy = state()?.copy;
    const link = schedule()?.parent;
    if (!copy || !link) return undefined;
    const parent = props.source.parent();
    return {
      parentName: parent?.name,
      parentLoading: props.source.parentLoading(),
      parentError: props.source.parentError(),
      definition: parent?.definition,
      missing: parent?.missing,
      onRetryParent: () =>
        fireAndForget(props.source.refreshParent(), 'routines'),
      onOpenParent: () => props.onOpenRoutine(link.id),
    };
  };
  const definitions = () => state()?.subRoutines ?? [];
  /** Why the Enabled switch can't change right now. */
  const activationHint = () => {
    if (!activationDisabled() || !isOwned()) return undefined;
    if (isRunning()) return 'Wait for the current run to finish';
    if (nextRun() === 'No upcoming runs')
      return 'Update the schedule before turning it on';
    return 'Fix the routine before turning it on';
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
          identityIcon={props.identityIcon}
          {...routineSections({
            draft: state,
            onChange: setState,
            withSteps: withDraftSteps,
            version: editorVersion,
            slots: props.slots,
            defaultModel: props.defaultModel,
            decisionsEnabled: props.decisionsEnabled,
            connected: connectedApps,
            taskDisabled: () => !props.source.canEditTask(),
            settingsDisabled: props.source.codeUpdatePending,
            runsAs: () =>
              routine().ownerId === props.userId()
                ? 'You'
                : getDisplayName(tryMacroId(routine().ownerId)) || 'Owner',
            runsAsDescription: 'Steps and AI act with the owner’s access.',
            unsupported: (
              <p class="text-sm text-ink-muted">
                This routine has an unsupported task configuration.
              </p>
            ),
            copySource,
          })}
          draft={
            state() ?? {
              ...createEmptyDraft(props.defaultModel),
              name: routine().name,
            }
          }
          onChange={setState}
          stepsReadOnly={routine().isCopy}
          taskDisabled={!props.source.canEditTask()}
          disabled={
            !isOwned() ||
            isRunning() ||
            !state() ||
            props.source.codeUpdatePending()
          }
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
                  runDisabled={runDisabled()}
                  hideRun={props.source.copyRunBlocked()}
                  activationDisabled={activationDisabled()}
                  copyDisabled={!prompt()}
                  onRun={runNow}
                  onEnabled={(enabled) => props.source.setEnabled(enabled)}
                  onCopyPrompt={copyPrompt}
                />
              </>
            )
          }
          actions={
            isOwned() && (
              <Dropdown
                placement="bottom-start"
                onOpenChange={props.onActionsOpenChange}
              >
                <Dropdown.Trigger
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Routine actions"
                >
                  <DotsIcon class="size-4" />
                </Dropdown.Trigger>
                <Dropdown.Content portalScope="local">
                  <Dropdown.Group>
                    {props.appearanceMenu}
                    <Show when={props.source.canDuplicate()}>
                      <Dropdown.Item
                        disabled={!state() || props.source.duplicationPending()}
                        onSelect={() => props.source.duplicate()}
                      >
                        <CopyIcon class="size-4" />
                        Duplicate
                      </Dropdown.Item>
                    </Show>
                    <Show when={props.onShare}>
                      <Dropdown.Item onSelect={props.onShare}>
                        <ShareIcon class="size-4" />
                        Share
                      </Dropdown.Item>
                    </Show>
                    <Show when={props.onStopSharing}>
                      <Dropdown.Item
                        disabled={props.stopSharingPending}
                        onSelect={props.onStopSharing}
                      >
                        <LinkBreakIcon class="size-4" />
                        {t('subRoutines.stopSharing')}
                      </Dropdown.Item>
                    </Show>
                    <Show when={props.onRetrySharing}>
                      <Dropdown.Item onSelect={props.onRetrySharing}>
                        <ArrowClockwiseIcon class="size-4" />
                        {t('subRoutines.retrySharing')}
                      </Dropdown.Item>
                    </Show>
                    <Show when={props.source.canKeepAsOwn()}>
                      <Dropdown.Item
                        disabled={props.source.keepAsOwnPending()}
                        onSelect={() => props.source.keepAsOwn()}
                      >
                        <ArrowUpRightIcon class="size-4" />
                        {t('subRoutines.keep')}
                      </Dropdown.Item>
                    </Show>
                  </Dropdown.Group>
                  <Dropdown.Separator />
                  <Dropdown.Group>
                    <Dropdown.Item
                      class="text-failure-ink"
                      disabled={props.source.codeUpdatePending()}
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
              <Show when={activationHint()}>
                {(hint) => (
                  <span class="hidden basis-full text-xs text-ink-muted touch:block">
                    {hint()}
                  </span>
                )}
              </Show>
              <Show when={routine().parent}>
                {(link) => (
                  <>
                    <span aria-hidden="true" class="text-ink-extra-muted">
                      ·
                    </span>
                    <Show
                      when={props.source.parent()}
                      fallback={<span>{t('subRoutines.createdByGone')}</span>}
                    >
                      {(parent) => (
                        <Button
                          variant="ghost"
                          size="xs"
                          class="min-w-0 max-w-full touch:min-h-[44px]"
                          onClick={() => props.onOpenRoutine(link().id)}
                        >
                          <span class="min-w-0 truncate">
                            {t('subRoutines.createdBy', {
                              name: parent().name,
                            })}
                          </span>
                          <ArrowUpRightIcon class="size-3 shrink-0" />
                        </Button>
                      )}
                    </Show>
                    <Show when={link().pausedByParent && !routine().enabled}>
                      <span class="text-xs text-ink-muted">
                        {t('subRoutines.pausedWithParent')}
                      </span>
                    </Show>
                  </>
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
          created={
            isOwned() &&
            props.source.subRoutines().length > 0 && (
              <RoutineSubRoutines
                active={subRoutineItems(
                  props.source.subRoutines(),
                  false,
                  definitions()
                )}
                finished={subRoutineItems(
                  props.source.subRoutines(),
                  true,
                  definitions()
                )}
                onOpen={props.onOpenRoutine}
              />
            )
          }
          notice={
            <Show when={isOwned() && props.source.codeReview()}>
              {(review) => (
                <CodeReviewNotice
                  review={review()}
                  paused={!isActive()}
                  disabled={approvalDisabled()}
                  onDiscardEdits={
                    autosave.dirty() && !autosave.saving()
                      ? () => {
                          autosave.cancel();
                          initializeDraft();
                        }
                      : undefined
                  }
                  onApprove={() =>
                    fireAndForget(approveCodeUpdate(), 'routines')
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
                describeStart={(record) =>
                  record.run &&
                  runStartLine(
                    record.run,
                    record.startedAt,
                    (id) =>
                      id === props.userId()
                        ? 'you'
                        : getDisplayName(tryMacroId(id)) || 'someone',
                    formatDateAndTime
                  )
                }
                onOpenItem={props.onOpenItem}
                onOpenRoutine={props.onOpenRoutine}
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
