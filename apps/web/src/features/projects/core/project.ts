/** User-facing project identity. It is an initiative, never a folder. */
export type Project = {
  id: string;
  name: string;
  descriptionDocumentId: string;
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
  sharing: ProjectSharing;
};

export type ProjectSharing = {
  linkShare?: 'PUBLIC' | 'TEAM' | null;
  linkShareAccessLevel?: ProjectAccess | null;
  teamShareAccessLevel?: ProjectAccess | null;
  channelSharePermissions?:
    | readonly {
        channel_id: string;
        access_level: ProjectAccess;
      }[]
    | null;
};

/** Channel changes are operations so editing one grant preserves the others. */
export type ProjectSharingPatch = Pick<
  ProjectSharing,
  'linkShare' | 'linkShareAccessLevel' | 'teamShareAccessLevel'
> & {
  channelSharePermissions?: {
    channelId: string;
    operation: 'add' | 'remove' | 'replace';
    accessLevel?: Exclude<ProjectAccess, 'owner'>;
  }[];
};

export type ProjectFilters = {
  query?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  dueBefore?: string;
  dueAfter?: string;
  sort?: 'updated' | 'name' | 'due';
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
