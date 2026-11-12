import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { MobileCreateMenu } from '@components/app/mobile/MobileCreateMenu';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import ListPlusIcon from '@icon/system/regular/list-plus.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Telemetry } from '@macro-inc/observability';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { Button, Dropdown, Hotkey, PillButton } from '@ui';
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

  return (
    <Show
      when={isMobile()}
      fallback={
        <Dropdown
          open={state.open}
          onOpenChange={setOpen}
          placement="bottom-end"
        >
          <Show
            when={props.inline}
            fallback={
              <Dropdown.Trigger variant="secondary" size="md">
                <PlusIcon class="size-4" />
                {props.onCreateTask ? 'Add task' : 'Add existing tasks'}
                <CaretDownIcon class="size-4" />
              </Dropdown.Trigger>
            }
          >
            <Dropdown.Trigger as={PillButton} tone="cta" icon={PlusIcon}>
              Add task
              <CaretDownIcon class="size-4" />
            </Dropdown.Trigger>
          </Show>
          <Show when={state.open}>
            <Show
              when={state.mode === 'choices'}
              fallback={
                <EditorPopover onClose={close}>{picker()}</EditorPopover>
              }
            >
              <Dropdown.Content
                onKeyDown={(event) => {
                  if (event.ctrlKey || event.metaKey || event.altKey) return;
                  if (event.key.toLowerCase() !== 'c') return;
                  event.preventDefault();
                  event.stopPropagation();
                  createTask();
                }}
              >
                <Dropdown.Group>
                  <Dropdown.Item aria-label="New task" onSelect={createTask}>
                    <PlusIcon class="size-4" />
                    New task
                    <Hotkey shortcut="c" theme="clear" class="ml-auto" />
                  </Dropdown.Item>
                  <Dropdown.Item
                    closeOnSelect={false}
                    onSelect={chooseExisting}
                  >
                    <ListPlusIcon class="size-4" />
                    Add existing tasks
                  </Dropdown.Item>
                </Dropdown.Group>
              </Dropdown.Content>
            </Show>
          </Show>
        </Dropdown>
      }
    >
      <MobileDrawer open={state.open} onOpenChange={setOpen}>
        <Show
          when={props.inline}
          fallback={
            <FloatRegion region="accessory">
              <div class="flex justify-end px-(--mobile-chrome-gutter) pointer-events-auto">
                <MobileCreateMenu
                  label="Task"
                  items={[
                    { label: 'New task', icon: PlusIcon, onSelect: createTask },
                    {
                      label: 'Add existing tasks',
                      icon: ListPlusIcon,
                      onSelect: openExisting,
                    },
                  ]}
                />
              </div>
            </FloatRegion>
          }
        >
          <MobileDrawer.Trigger as={PillButton} tone="cta" icon={PlusIcon}>
            Add task
            <CaretDownIcon class="size-4" />
          </MobileDrawer.Trigger>
        </Show>
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content>
            <MobileDrawer.Handle />
            <MobileDrawer.Title class="px-6 pb-3 text-lg font-semibold">
              {state.mode === 'choices' ? 'Add task' : 'Add existing tasks'}
            </MobileDrawer.Title>
            <MobileDrawer.ScrollBody>
              <Show when={state.mode === 'choices'} fallback={pickerFields()}>
                <MobileDrawer.Section>
                  <MobileDrawer.Item onClick={createTask}>
                    <PlusIcon class="size-5" />
                    New task
                  </MobileDrawer.Item>
                  <MobileDrawer.Item onClick={chooseExisting}>
                    <ListPlusIcon class="size-5" />
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
