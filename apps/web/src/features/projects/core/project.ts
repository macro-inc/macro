import type { EntityAppearance } from '../../entity-appearance/core/appearance';
/** User-facing project identity. It is an initiative, never a folder. */
export type Project = {
  id: string;
  name: string;
  appearance?: EntityAppearance | null;
  updatedAt: string;
  createdAt?: string;
  access?: ProjectAccess;
  taskCount?: number;
  completedTaskCount?: number;
};

export type ProjectScope = 'all' | 'assigned-to-me' | 'created-by-me';

export type ProjectAccess = 'view' | 'comment' | 'edit' | 'owner';

/** What chips and previews may read; counts and membership stay on the project view. */
export type ProjectIdentity = Pick<Project, 'id' | 'name' | 'appearance'> & {
  ownerId: string;
  access: ProjectAccess;
};

export type ProjectDetail = Project & {
  ownerId: string;
  memberIds: readonly string[];
  taskIds: readonly string[];
  access: ProjectAccess;
  createdAt: string;
};

export type ProjectFilters = {
  query?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  owner?: string;
  dueBefore?: string;
  dueAfter?: string;
  sort?: 'updated' | 'created';
  descending?: boolean;
};

export type ProjectListGroupBy = 'none' | 'status' | 'priority' | 'assignee';

/** Persisted presentation and editable filters, separate from search and scroll. */
export type ProjectCollectionSettings = {
  layout: 'list' | 'gantt';
  status: string;
  priority: string;
  dueBefore: string;
  dueAfter: string;
  mine: boolean;
  sort: NonNullable<ProjectFilters['sort']>;
  groupBy: ProjectListGroupBy;
};

export const DEFAULT_PROJECT_SETTINGS: ProjectCollectionSettings = {
  layout: 'list',
  status: '',
  priority: '',
  dueBefore: '',
  dueAfter: '',
  mine: false,
  sort: 'updated',
  groupBy: 'status',
};

export type TaskProjectReference =
  | { state: 'none' }
  | { state: 'unavailable' }
  | {
      state: 'visible';
      id: string;
      name: string;
      appearance?: EntityAppearance | null;
    };

export const canEditProject = (project: Pick<Project, 'access'>) =>
  project.access === 'edit' || project.access === 'owner';

export const canDeleteProject = (project: Pick<Project, 'access'>) =>
  project.access === 'owner';

export const canDiscussProject = (project: ProjectDetail) =>
  project.access !== 'view';

export type ProjectSection = 'overview' | 'tasks' | 'time';

export function isProjectSection(value: unknown): value is ProjectSection {
  return value === 'overview' || value === 'tasks' || value === 'time';
}

/** A project's sections: Time only while time tracking is on. */
export function projectSections(
  timeTracking: boolean
): readonly ProjectSection[] {
  return timeTracking ? ['overview', 'tasks', 'time'] : ['overview', 'tasks'];
}

/**
 * The section a project route shows: a Time link opened with time tracking
 * off shows the Overview. A flag still loading is not off.
 */
export function shownProjectSection(
  section: ProjectSection,
  timeTracking: { enabled: boolean; loading: boolean }
): ProjectSection {
  if (section !== 'time' || timeTracking.enabled || timeTracking.loading)
    return section;
  return 'overview';
}
