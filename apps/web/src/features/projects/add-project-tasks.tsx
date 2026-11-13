import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { Button } from '@ui';
import { createMemo, type JSX, onCleanup, Show, Suspense } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useProjectsContext } from './context/projects-context';
import type { ProjectDetail } from './core/project';
import { AddProjectTasksView } from './views/add-project-tasks';
import { MobileAddProjectTasks } from './views/mobile/add-project-tasks';

type AddState = {
  open: boolean;
  mode: 'choices' | 'existing';
  selected: string[];
  error?: string;
  saving: boolean;
  savingProjectId?: string;
};

export function AddProjectTasks(props: {
  project: ProjectDetail;
  onCreateTask?: () => void;
  inline?: boolean;
}) {
  const commands = useProjectsContext().createCommands();
  const [state, setState] = createStore<AddState>({
    open: false,
    mode: 'choices',
    selected: [],
    saving: false,
  });
  let generation = 0;
  onCleanup(() => generation++);
  const excludedIds = createMemo(() => new Set(props.project.taskIds));
  const isSaving = () =>
    state.saving && state.savingProjectId === props.project.id;
  const setOpen = (open: boolean) => {
    if (isSaving() && !open) return;
    if (open) {
      if (!isSaving()) setState('saving', false);
      generation++;
      setState({
        mode: props.onCreateTask ? 'choices' : 'existing',
        selected: [],
        error: undefined,
      });
    } else {
      generation++;
    }
    setState('open', open);
  };
  const close = () => setOpen(false);
  const chooseExisting = () => setState('mode', 'existing');
  const openExisting = () => {
    setOpen(true);
    chooseExisting();
  };
  const createTask = () => {
    close();
    props.onCreateTask?.();
  };
  const add = async () => {
    const projectId = props.project.id;
    const taskIds = state.selected.filter((id) => !excludedIds().has(id));
    if (isSaving() || !taskIds.length) return;
    const request = generation;
    setState({ saving: true, savingProjectId: projectId, error: undefined });
    try {
      const results = await Telemetry.span(
        'project.tasks.assign',
        async (span) => {
          span.setAttr('project.id', projectId);
          span.setAttr('task.count', taskIds.length);
          const results = await commands.assignTasks(projectId, taskIds);
          const failed = results.filter((result) => result.error);
          span.setAttr('task.failed_count', failed.length);
          if (failed.length) span.error('Some tasks could not be added');
          return results;
        }
      );
      if (request !== generation || props.project.id !== projectId) return;
      const failed = results.filter((result) => result.error);
      if (!failed.length) {
        setState('saving', false);
        close();
        return;
      }
      setState(
        'selected',
        failed.map((result) => result.taskId)
      );
      setState(
        'error',
        `${failed.length} ${failed.length === 1 ? 'task could' : 'tasks could'} not be added. ${failed[0].error}`
      );
    } catch (error) {
      if (request !== generation || props.project.id !== projectId) return;
      setState(
        'error',
        error instanceof Error
          ? error.message
          : 'Could not add tasks. Try again.'
      );
    } finally {
      if (request === generation) setState('saving', false);
    }
  };
  const pickerFields = () => (
    <>
      <div inert={state.saving} classList={{ 'opacity-50': state.saving }}>
        <Suspense fallback={<p role="status">Loading tasks…</p>}>
          <PropertyEntitySelector
            config={{
              specificEntityType: 'TASK',
              isMultiSelect: true,
              placeholder: 'Search tasks…',
              excludedIds,
            }}
            selectedOptions={() => new Set(state.selected)}
            setSelectedOptions={(ids) => {
              if (!state.saving) setState('selected', [...ids]);
            }}
            onClose={close}
          />
        </Suspense>
      </div>
      <Show when={state.error}>
        {(message) => (
          <p role="alert" class="px-3 pb-2 text-sm text-failure">
            {message()}
          </p>
        )}
      </Show>
    </>
  );
  const pickerFooter = () => (
    <div
      class="flex justify-end gap-2 border-t border-edge-muted p-2"
      onKeyDown={(event) => {
        // The selector owns list navigation; footer buttons keep native Enter behavior.
        if (['Enter', 'ArrowUp', 'ArrowDown'].includes(event.key))
          event.stopPropagation();
      }}
    >
      <Button variant="ghost" size="sm" disabled={state.saving} onClick={close}>
        Cancel
      </Button>
      <Button
        size="sm"
        variant="primary"
        disabled={state.saving || !state.selected.length}
        onClick={() => fireAndForget(add(), 'projects')}
      >
        {state.saving
          ? 'Adding tasks…'
          : `Add ${state.selected.length || ''} ${state.selected.length === 1 ? 'task' : 'tasks'}`}
      </Button>
    </div>
  );
  const picker = () => (
    <>
      {pickerFields()}
      {pickerFooter()}
    </>
  );

  const view: AddProjectTasksViewProps = {
    get open() {
      return state.open;
    },
    get mode() {
      return state.mode;
    },
    get canCreate() {
      return Boolean(props.onCreateTask);
    },
    get inline() {
      return Boolean(props.inline);
    },
    onOpenChange: setOpen,
    close,
    createTask,
    chooseExisting,
    openExisting,
    picker,
    pickerFields,
    pickerFooter,
  };
  return (
    <Show when={isTouchDevice()} fallback={<AddProjectTasksView {...view} />}>
      <MobileAddProjectTasks {...view} />
    </Show>
  );
}

export type AddProjectTasksViewProps = {
  open: boolean;
  mode: 'choices' | 'existing';
  canCreate: boolean;
  inline: boolean;
  onOpenChange(open: boolean): void;
  close(): void;
  createTask(): void;
  chooseExisting(): void;
  openExisting(): void;
  picker(): JSX.Element;
  pickerFields(): JSX.Element;
  pickerFooter(): JSX.Element;
};
