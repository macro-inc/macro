import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import ListPlusIcon from '@icon/system/regular/list-plus.svg';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { Button } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { useProjectsContext } from '../../context/projects-context';
import type { ProjectDetail } from '../../core/project';
import { createAddProjectTasks } from '../../primitives/add-project-tasks';

/** Add existing tasks on touch: a picker sheet; phones show the icon alone. */
export function MobileAddProjectTasks(props: { project: ProjectDetail }) {
  const commands = useProjectsContext().createCommands();
  const picker = createAddProjectTasks({
    project: () => props.project,
    assignTasks: commands.assignTasks,
  });
  const [open, setOpen] = createSignal(false);
  const cancel = () => {
    if (!picker.saving()) setOpen(false);
  };
  const add = async () => {
    if (await picker.add()) setOpen(false);
  };

  return (
    <>
      <Button
        variant="secondary"
        size={isMobile() ? 'icon-md' : 'md'}
        aria-label={isMobile() ? 'Add existing tasks' : undefined}
        onClick={() => {
          picker.reset();
          setOpen(true);
        }}
      >
        <ListPlusIcon class={isMobile() ? 'size-6' : 'size-4'} />
        {isMobile() ? null : 'Add existing tasks'}
      </Button>
      <PickerSheet.Root open={open()} onCancel={cancel}>
        <PickerSheet.Header
          title="Add tasks"
          onDone={() => fireAndForget(add(), 'projects')}
          doneDisabled={picker.saving() || !picker.selected().size}
        />
        <PickerSheet.Body>
          <Show when={picker.error()}>
            {(message) => (
              <p role="alert" class="shrink-0 px-4 pb-2 text-sm text-failure">
                {message()}
              </p>
            )}
          </Show>
          <div
            inert={picker.saving()}
            class="flex min-h-0 flex-1 flex-col"
            classList={{ 'opacity-50': picker.saving() }}
          >
            <Suspense
              fallback={
                <p role="status" class="px-4 py-3 text-ink-muted">
                  Loading tasks…
                </p>
              }
            >
              <PropertyEntitySelector
                config={{
                  specificEntityType: 'TASK',
                  isMultiSelect: true,
                  placeholder: 'Search tasks…',
                  excludedIds: picker.excludedIds,
                  fillHeight: true,
                }}
                selectedOptions={picker.selected}
                setSelectedOptions={picker.select}
                onCancel={cancel}
              />
            </Suspense>
          </div>
        </PickerSheet.Body>
      </PickerSheet.Root>
    </>
  );
}
