import { t } from '@app/lib/i18n';
import { ProgressRing, Tooltip } from '@ui';
import { Show } from 'solid-js';
import type { Project } from '../core/project';

/** The same completion count in project rows and the phone Tasks shortcut. */
export function ProjectProgress(props: {
  project: Pick<Project, 'taskCount' | 'completedTaskCount'>;
  tabIndex?: number;
}) {
  const label = () => {
    const total = props.project.taskCount ?? 0;
    const completed = props.project.completedTaskCount ?? 0;
    if (total === 0) return t('common.progressNoTasks');
    if (completed >= total) return t('common.progressAllDone');
    return t('common.progressTasksDone', { completed, count: total });
  };
  const hasProgress = () =>
    props.project.taskCount !== undefined &&
    props.project.completedTaskCount !== undefined;
  const fraction = () => {
    const total = props.project.taskCount ?? 0;
    return total > 0 ? (props.project.completedTaskCount ?? 0) / total : 0;
  };

  return (
    <Show when={hasProgress()}>
      <Tooltip.Root>
        <Tooltip.Trigger
          as="span"
          role="progressbar"
          aria-label={label()}
          aria-valuemin={0}
          aria-valuemax={props.project.taskCount ?? 0}
          aria-valuenow={props.project.completedTaskCount ?? 0}
          tabIndex={props.tabIndex ?? 0}
          class="flex size-[22px] shrink-0 items-center justify-center [&_svg]:size-3.5"
        >
          <ProgressRing fraction={fraction()} />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content>{label()}</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Show>
  );
}
