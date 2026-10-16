/**
 * Compact header chip for the session's linked Macro task: its title, opening
 * the task in a split. While the preview loads, or when the viewer cannot see
 * the task, it reads "Task" and still opens it.
 */

import { useSplitLayout } from '@components/app/split-layout/layout';
import { PopupPreview } from '@core/component/DocumentPreview';
import { EntityIcon } from '@core/component/EntityIcon';
import { HoverCard } from '@core/component/HoverCard';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import { Layer } from '@ui';
import { type JSX, Suspense } from 'solid-js';
import { ChipShell } from './AgentSessionChipShell';

function TaskChipButton(props: {
  taskId: string;
  title?: string;
}): JSX.Element {
  const { openWithSplit } = useSplitLayout();
  const navHandlers = useSplitNavigationHandler<HTMLButtonElement>((event) => {
    event.stopPropagation();
    openWithSplit(
      { type: 'task', id: props.taskId },
      { preferNewSplit: openInNewSplitForMention(event.shiftKey, true) }
    );
  });
  const label = () => props.title?.replaceAll('\n', ' ').trim() || 'Task';

  return (
    <button
      type="button"
      data-agent-task={props.taskId}
      title={props.title ?? 'Open task'}
      {...navHandlers}
    >
      <ChipShell>
        <EntityIcon targetType="task" size="xs" />
        <span class="min-w-0 truncate">{label()}</span>
      </ChipShell>
    </button>
  );
}

function PreviewedTaskChip(props: { taskId: string }): JSX.Element {
  const [preview] = useItemPreview(() => ({
    id: props.taskId,
    type: 'document',
  }));
  const title = () => {
    const item = preview();
    return isAccessiblePreviewItem(item) ? item.name : undefined;
  };

  return (
    <HoverCard
      triggerClass="min-w-0 max-w-full"
      disabled={title() === undefined}
      trigger={<TaskChipButton taskId={props.taskId} title={title()} />}
      content={
        <PopupPreview
          mouseEnter={() => {}}
          mouseLeave={() => {}}
          documentInfo={{
            id: props.taskId,
            type: 'task',
            params: {},
            isOpenable: true,
          }}
        />
      }
    />
  );
}

export function AgentTaskChip(props: { taskId: string }): JSX.Element {
  return (
    <Layer depth={2}>
      <Suspense fallback={<TaskChipButton taskId={props.taskId} />}>
        <PreviewedTaskChip taskId={props.taskId} />
      </Suspense>
    </Layer>
  );
}
