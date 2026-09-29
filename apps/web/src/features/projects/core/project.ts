/** User-facing project identity. It is an initiative, never a folder. */
export type Project = {
  id: string;
  name: string;
  /** Collaborative surface holding the description; empty when unknown. */
  descriptionSurfaceId: string;
  updatedAt: string;
  access?: ProjectAccess;
  taskCount?: number;
  completedTaskCount?: number;
};

export type ProjectAccess = 'view' | 'comment' | 'edit' | 'owner';

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
  dueBefore?: string;
  dueAfter?: string;
  sort?: 'updated' | 'created';
  descending?: boolean;
};

export type TaskProjectReference =
  | { state: 'none' }
  | { state: 'unavailable' }
  | { state: 'visible'; id: string; name: string };

export const canEditProject = (project: ProjectDetail) =>
  project.access === 'edit' || project.access === 'owner';

export const canDiscussProject = (project: ProjectDetail) =>
  project.access !== 'view';

export type ProjectSection = 'overview' | 'tasks';
