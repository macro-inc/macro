import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { Button } from '@ui';
import { type JSX, Show, Suspense } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useProjectsContext } from './context/projects-context';
import { canEditProject, type ProjectDetail } from './core/project';
import { createAddProjectTasks } from './primitives/add-project-tasks';
import { AddProjectTasksView } from './views/add-project-tasks';
import { MobileAddProjectTasks } from './views/mobile/add-project-tasks';

type AddState = {
  open: boolean;
  mode: 'choices' | 'existing';
};

export function AddProjectTasks(props: {
  project: ProjectDetail;
  onCreateTask?: () => void;
  inline?: boolean;
}) {
  const commands = useProjectsContext().createCommands();
  const selection = createAddProjectTasks({
    project: () => props.project,
    assignTasks: commands.assignTasks,
  });
  const [state, setState] = createStore<AddState>({
    open: false,
    mode: 'choices',
  });
  const setOpen = (open: boolean) => {
    if (selection.saving()) return;
    selection.reset();
    setState({ open, mode: props.onCreateTask ? 'choices' : 'existing' });
  };
  const error = () => {
    const failure = selection.error();
    if (!failure) return undefined;
    if (failure.kind === 'partial') {
      return t('viewMenus.someTasksFailed', {
        count: failure.count,
        error: failure.reason,
      });
    }
    return failure.message ?? t('viewMenus.addTasksFailed');
  };
  const close = () => setOpen(false);
  const chooseExisting = () => setState('mode', 'existing');
  const openExisting = () => {
    setOpen(true);
    chooseExisting();
  };
  const createTask = () => {
    if (!canEditProject(props.project)) return;
    close();
    props.onCreateTask?.();
  };
  const add = async () => {
    if (await selection.add()) close();
  };
  const pickerFields = (presentation?: 'sheet') => (
    <>
      <div
        inert={selection.saving()}
        classList={{
          'opacity-50': selection.saving(),
          'flex min-h-0 flex-1 flex-col': presentation === 'sheet',
        }}
      >
        <Suspense fallback={<p role="status">{t('viewMenus.loadingTasks')}</p>}>
          <PropertyEntitySelector
            presentation={presentation}
            config={{
              specificEntityType: 'TASK',
              isMultiSelect: true,
              placeholder: t('viewMenus.searchTasks'),
              excludedIds: selection.excludedIds,
              fillHeight: presentation === 'sheet',
              visibleCheckboxes: presentation === 'sheet',
            }}
            selectedOptions={selection.selected}
            setSelectedOptions={selection.select}
            onClose={close}
            onCancel={close}
          />
        </Suspense>
      </div>
      <Show when={error()}>
        {(message) => (
          <p role="alert" class="px-3 pb-2 text-sm text-failure">
            {message()}
          </p>
        )}
      </Show>
    </>
  );
  const pickerFooter = (presentation?: 'sheet') => (
    <div
      class={
        presentation === 'sheet'
          ? 'flex shrink-0 justify-end gap-4 px-4 pt-4'
          : 'flex justify-end gap-2 border-t border-edge-muted p-2'
      }
      onKeyDown={(event) => {
        // The selector owns list navigation; footer buttons keep native Enter behavior.
        if (['Enter', 'ArrowUp', 'ArrowDown'].includes(event.key))
          event.stopPropagation();
      }}
    >
      <Button
        variant="ghost"
        size={presentation === 'sheet' ? 'md' : 'sm'}
        disabled={selection.saving()}
        onClick={close}
      >
        {t('common.cancel')}
      </Button>
      <Button
        size={presentation === 'sheet' ? 'md' : 'sm'}
        variant="primary"
        disabled={selection.saving() || !selection.selected().size}
        onClick={() => fireAndForget(add(), 'projects')}
      >
        {selection.saving()
          ? t('common.addingTasks')
          : t('common.addTasks', { count: selection.selected().size })}
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
    <Show when={canEditProject(props.project)}>
      <Show when={isTouchDevice()} fallback={<AddProjectTasksView {...view} />}>
        <MobileAddProjectTasks {...view} />
      </Show>
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
  pickerFields(presentation?: 'sheet'): JSX.Element;
  pickerFooter(presentation?: 'sheet'): JSX.Element;
};
