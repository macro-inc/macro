import { Property } from '@property';
import { Dropdown } from '@ui';
import { Show } from 'solid-js';
import { Projects } from './projects';
import { ProjectPicker } from './views/project-picker';

type AnchorRect = { x: number; y: number; width?: number; height?: number };

/** The project picker in the same popover shell as the property editors. */
export function ProjectPickerPopover(props: {
  taskIds: readonly string[];
  open: boolean;
  onOpenChange(open: boolean): void;
  getAnchorRect(): AnchorRect | undefined;
}) {
  let openedAt = 0;
  // A context menu hands focus back to its row just after this opens; 100ms
  // (as in TagPickerPopover) keeps that focus-out from dismissing it.
  const close = () => {
    if (performance.now() - openedAt > 100) props.onOpenChange(false);
  };
  return (
    <Dropdown
      open={props.open}
      onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}
      getAnchorRect={props.getAnchorRect}
      placement="bottom-start"
    >
      <Show when={props.open}>
        {(_) => {
          openedAt = performance.now();
          return (
            <Property.EditorPopover onClose={close}>
              <Projects>
                <ProjectPicker
                  taskIds={props.taskIds}
                  onClose={() => props.onOpenChange(false)}
                />
              </Projects>
            </Property.EditorPopover>
          );
        }}
      </Show>
    </Dropdown>
  );
}
