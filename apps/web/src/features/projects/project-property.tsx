import CaretDownIcon from '@phosphor/caret-down.svg';
import CircleDashedEmpty from '@phosphor/circle-dashed.svg';
import StackIcon from '@phosphor/stack.svg';
import { Property } from '@property';
import { Dropdown, HoverCard, Layer } from '@ui';
import { createSignal, Show } from 'solid-js';
import type { TaskProjectReference } from './core/project';
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

/** Task list cell for a task's project, matching the other property cells. */
export function ProjectPropertyCell(props: {
  taskId: string;
  reference?: TaskProjectReference;
}) {
  const [anchor, setAnchor] = createSignal<HTMLElement>();
  const project = () =>
    props.reference?.state === 'visible' ? props.reference : undefined;
  const emptyLabel = () =>
    props.reference?.state === 'unavailable'
      ? 'Unavailable project'
      : 'Project';
  return (
    <>
      <HoverCard
        content={
          <div class="flex flex-row gap-2 items-center">
            <div class="flex items-center gap-2 text-ink-muted">
              <StackIcon class="size-3.5 text-ink-muted" />
              <span class="text-xs">Project</span>
            </div>
            <div class="inline-flex min-w-0 items-center gap-1.5 px-2 py-0.5 text-xs leading-5 text-ink-muted w-fit rounded-sm">
              <span class="truncate max-w-37.5">
                {project()?.name ?? `No project set`}
              </span>
            </div>
          </div>
        }
        disabled={anchor() !== undefined}
        contentClass="rounded-xl p-1.5 px-3 glass bg-menu-glass"
        // The trigger is a flex item; min-w-0 lets long names truncate in the column.
        triggerClass="w-full min-w-0"
      >
        <Layer depth={2}>
          <button
            type="button"
            class="list-property-cell cursor-default inline-flex w-full max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-full px-2 py-1.5 text-left leading-tight hover:bg-surface/50 @max-[840px]/u-list:px-1"
            onClick={(event) => {
              event.stopPropagation();
              setAnchor(event.currentTarget);
            }}
          >
            <Show
              when={project()}
              fallback={
                <>
                  <CircleDashedEmpty class="size-3 shrink-0 opacity-50 @max-[840px]/u-list:size-4" />
                  <span class="min-w-0 flex-1 truncate opacity-50 @max-[840px]/u-list:hidden">
                    {emptyLabel()}
                  </span>
                </>
              }
            >
              {(project) => (
                <>
                  <StackIcon class="size-3 shrink-0 @max-[840px]/u-list:size-4" />
                  <span class="min-w-0 max-w-full flex-1 truncate @max-[840px]/u-list:hidden">
                    {project().name}
                  </span>
                </>
              )}
            </Show>
            <CaretDownIcon class="size-3 shrink-0 @max-[840px]/u-list:hidden" />
          </button>
        </Layer>
      </HoverCard>
      <ProjectPickerPopover
        taskIds={[props.taskId]}
        open={anchor() !== undefined}
        onOpenChange={(open) => {
          if (open) return;
          const trigger = anchor();
          setAnchor(undefined);
          // No Kobalte trigger to return focus to, so hand it back ourselves.
          setTimeout(() => trigger?.isConnected && trigger.focus(), 0);
        }}
        getAnchorRect={() => anchor()?.getBoundingClientRect()}
      />
    </>
  );
}
