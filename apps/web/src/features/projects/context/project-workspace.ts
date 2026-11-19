import type { JSX } from 'solid-js';
import type { TasksViewProviderProps } from '../../tasks-view/tasks-view-context';
import type { ProjectDetail, ProjectSection } from '../core/project';
import type { ProjectSource, ProjectsContext } from './projects-context';

export type ProjectWorkspaceProps = {
  project: ProjectDetail;
  source: ProjectSource;
  commands: ReturnType<ProjectsContext['createCommands']>;
  section: ProjectSection;
  onOpenTask: NonNullable<TasksViewProviderProps['onOpenTask']>;
  onCreateTask: NonNullable<TasksViewProviderProps['onCreateTask']>;
  discussion: JSX.Element;
  description: JSX.Element;
};
