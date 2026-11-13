import type { ProjectTitleMenuViewProps } from '../project-title-menu';
import {
  ProjectTitleActions,
  ProjectTitleLabel,
} from './shared/project-title-parts';

export function ProjectTitleMenuView(props: ProjectTitleMenuViewProps) {
  return (
    <>
      <div class="relative flex min-w-0 items-center gap-1.5">
        <ProjectTitleLabel project={props.project} />
      </div>
      <ProjectTitleActions
        project={props.project}
        tools={[
          props.actions.openInNewSplit,
          props.actions.rename,
          props.actions.status,
          props.actions.priority,
          props.actions.share,
          props.actions.remove,
        ]}
      />
    </>
  );
}
