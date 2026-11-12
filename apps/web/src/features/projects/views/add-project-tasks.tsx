import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import ListPlusIcon from '@icon/system/regular/list-plus.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Telemetry } from '@macro-inc/observability';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { Button, ButtonGroup, Dropdown } from '@ui';
import { createMemo, onCleanup, Show, Suspense } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useProjectsContext } from '../context/projects-context';
import type { ProjectDetail } from '../core/project';

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

  return (
    <Show
      when={isMobile() && (props.inline || props.onCreateTask)}
      fallback={
        <Show
          when={props.onCreateTask}
          fallback={
            <Dropdown
              open={state.open}
              onOpenChange={setOpen}
              placement="bottom-end"
            >
              <Dropdown.Trigger variant="secondary" size="md">
                <ListPlusIcon class="size-4" />
                Add existing tasks
              </Dropdown.Trigger>
              <Show when={state.open}>
                <EditorPopover onClose={close}>{picker()}</EditorPopover>
              </Show>
            </Dropdown>
          }
        >
          <ButtonGroup
            variant="secondary"
            size="md"
            aria-label="Add project task"
          >
            <ButtonGroup.Button onClick={createTask}>
              <PlusIcon class="size-4" />
              New task
            </ButtonGroup.Button>
            <Dropdown
              open={state.open}
              onOpenChange={setOpen}
              placement="bottom-end"
            >
              <Dropdown.Trigger
                as={ButtonGroup.Button}
                size="icon-md"
                aria-label="More task actions"
              >
                <CaretDownIcon class="size-4" />
              </Dropdown.Trigger>
              <Show when={state.open}>
                <EditorPopover onClose={close}>
                  <Show when={state.mode === 'choices'} fallback={picker()}>
                    <Dropdown.Item onSelect={createTask}>
                      New task
                    </Dropdown.Item>
                    <Dropdown.Item
                      closeOnSelect={false}
                      onSelect={chooseExisting}
                    >
                      Add existing tasks
                    </Dropdown.Item>
                  </Show>
                </EditorPopover>
              </Show>
            </Dropdown>
          </ButtonGroup>
        </Show>
      }
    >
      <Show
        when={props.inline}
        fallback={
          <FloatRegion region="accessory">
            <div class="flex justify-end px-(--mobile-chrome-gutter) pointer-events-auto">
              <Button variant="secondary" onClick={() => setOpen(true)}>
                <PlusIcon class="size-5" />
                Add task
              </Button>
            </div>
          </FloatRegion>
        }
      >
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <ListPlusIcon class="size-4" />
          Add existing tasks
        </Button>
      </Show>
      <MobileDrawer open={state.open} onOpenChange={setOpen}>
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label="Add project task">
            <MobileDrawer.Handle />
            <MobileDrawer.Label>Add task</MobileDrawer.Label>
            <MobileDrawer.ScrollBody>
              <Show when={state.mode === 'choices'} fallback={pickerFields()}>
                <MobileDrawer.Section>
                  <MobileDrawer.Item onClick={createTask}>
                    New task
                  </MobileDrawer.Item>
                  <MobileDrawer.Item onClick={chooseExisting}>
                    Add existing tasks
                  </MobileDrawer.Item>
                </MobileDrawer.Section>
              </Show>
            </MobileDrawer.ScrollBody>
            <Show when={state.mode === 'existing'}>{pickerFooter()}</Show>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}
