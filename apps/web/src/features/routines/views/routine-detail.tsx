import CopyIcon from '@phosphor/copy.svg';
import DotsIcon from '@phosphor/dots-three.svg';
import TrashIcon from '@phosphor/trash-simple.svg';
import { Dropdown } from '@ui';
import { type Accessor, createSignal, Match, Show, Switch } from 'solid-js';
import { RoutineEditor } from '../components/routine-editor';
import { RoutineRunButton } from '../components/routine-run-button';
import type { RoutineDetailSlots } from '../context/routine-slots';
import type { RoutineDetailSource } from '../context/routine-sources';
import type { HistoryResource } from '../core/history';
import { createEmptyDraft, getErrorMessage } from '../core/routine-draft';
import {
  createRoutineDetail,
  RoutineConflictError,
} from '../primitives/routine-detail';
import { RoutineHistory } from './routine-history';

export function RoutineDetailView(props: {
  source: RoutineDetailSource;
  userId: Accessor<string | undefined>;
  defaultModel: string;
  slots: RoutineDetailSlots;
  initialTab?: 'settings' | 'history';
  onRename(name: string): void;
  onBack(): void;
  onDelete(): void;
  onCopyPrompt(prompt: string): Promise<void>;
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
  } = createRoutineDetail(props.source, props);
  const [tab, setTab] = createSignal(props.initialTab ?? 'settings');
  const back = () => props.onBack();
  const copyPrompt = async () => {
    const prompt = state()?.prompt;
    if (prompt) await props.onCopyPrompt(prompt);
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
          tab={tab()}
          onTab={setTab}
          onBack={back}
          enabled={isActive()}
          runActions={
            <RoutineRunButton
              enabled={isActive()}
              runDisabled={runDisabled()}
              activationDisabled={activationDisabled()}
              copyDisabled={!state()?.prompt}
              onRun={runNow}
              onEnabled={(enabled) => props.source.setEnabled(enabled)}
              onCopyPrompt={() => void copyPrompt()}
            />
          }
          actions={
            <Dropdown placement="bottom-start">
              <Dropdown.Trigger
                variant="ghost"
                size="icon-sm"
                aria-label="Routine actions"
              >
                <DotsIcon class="size-5" />
              </Dropdown.Trigger>
              <Dropdown.Content portalScope="local">
                <Dropdown.Item
                  disabled={!state() || props.source.duplicationPending()}
                  onSelect={() => props.source.duplicate()}
                >
                  <CopyIcon class="size-4" />
                  Duplicate
                </Dropdown.Item>
                <Show when={isOwned()}>
                  <Dropdown.Item onSelect={props.onDelete}>
                    <TrashIcon class="size-4" />
                    Delete
                  </Dropdown.Item>
                </Show>
              </Dropdown.Content>
            </Dropdown>
          }
          nextRun={nextRun()}
          instructions={
            <Show when={state()}>
              <Show when={{ version: editorVersion() }} keyed>
                <props.slots.PromptEditor
                  initialValue={state()?.prompt ?? ''}
                  onChange={(prompt) =>
                    setState((draft) =>
                      draft.prompt === prompt ? draft : { ...draft, prompt }
                    )
                  }
                />
              </Show>
            </Show>
          }
          executionPicker={
            <Show when={state()}>
              {(draft) => (
                <props.slots.ExecutionPicker
                  target={draft().target}
                  onChange={(target) =>
                    setState((current) => ({ ...current, target }))
                  }
                />
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
                    onClick={() => void props.source.refreshHistory()}
                  >
                    Retry
                  </button>
                </p>
              </Show>
              <RoutineHistory
                records={props.source.history()}
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
