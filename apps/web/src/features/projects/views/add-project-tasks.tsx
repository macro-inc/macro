import ListPlusIcon from '@phosphor/list-plus.svg';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { Button, Dropdown } from '@ui';
import { createMemo, createSignal, Show, Suspense } from 'solid-js';
import { useProjectsContext } from '../context/projects-context';
import type { ProjectDetail } from '../core/project';

export function AddProjectTasks(props: { project: ProjectDetail }) {
  const commands = useProjectsContext().createCommands();
  const [open, setOpen] = createSignal(false);
  const [selected, setSelected] = createSignal(new Set<string>());
  const [error, setError] = createSignal<string>();
  const [saving, setSaving] = createSignal(false);
  const excludedIds = createMemo(() => new Set(props.project.taskIds));
  const close = () => {
    if (!saving()) setOpen(false);
  };
  const add = async () => {
    const taskIds = [...selected()].filter((id) => !excludedIds().has(id));
    if (saving() || !taskIds.length) return;
    setSaving(true);
    setError(undefined);
    try {
      const results = await commands.assignTasks(props.project.id, taskIds);
      const failed = results.filter((result) => result.error);
      if (!failed.length) {
        setOpen(false);
        return;
      }
      setSelected(new Set(failed.map((result) => result.taskId)));
      setError(
        `${failed.length} ${failed.length === 1 ? 'task could' : 'tasks could'} not be added. ${failed[0].error}`
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not add tasks. Try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dropdown
      open={open()}
      onOpenChange={(nextOpen) => {
        if (saving()) return;
        if (nextOpen) {
          setSelected(new Set<string>());
          setError(undefined);
        }
        setOpen(nextOpen);
      }}
      placement="bottom-end"
    >
      <Dropdown.Trigger variant="outline" size="md">
        <ListPlusIcon class="size-4" />
        Add existing tasks
      </Dropdown.Trigger>
      <Show when={open()}>
        <EditorPopover onClose={close}>
          <div inert={saving()} classList={{ 'opacity-50': saving() }}>
            <Suspense fallback={<p role="status">Loading tasks…</p>}>
              <PropertyEntitySelector
                config={{
                  specificEntityType: 'TASK',
                  isMultiSelect: true,
                  placeholder: 'Search tasks…',
                  excludedIds,
                }}
                selectedOptions={selected}
                setSelectedOptions={(ids) => {
                  if (!saving()) setSelected(ids);
                }}
                onClose={close}
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
          <div
            class="flex justify-end gap-2 border-t border-edge-muted p-2"
            onKeyDown={(event) => {
              // The selector owns document-level list navigation; footer buttons
              // keep their native Enter behavior without toggling another task.
              if (['Enter', 'ArrowUp', 'ArrowDown'].includes(event.key))
                event.stopPropagation();
            }}
          >
            <Button size="sm" disabled={saving()} onClick={close}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="cta"
              disabled={saving() || !selected().size}
              onClick={() => void add()}
            >
              {saving()
                ? 'Adding tasks…'
                : `Add ${selected().size || ''} ${selected().size === 1 ? 'task' : 'tasks'}`}
            </Button>
          </div>
        </EditorPopover>
      </Show>
    </Dropdown>
  );
}
