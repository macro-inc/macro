import type { createTaskWithProperties } from '@block-md/util/taskComposerProperties';
import type { Property, PropertyApiValues } from '@property/types';
import type { Accessor, ParentProps } from 'solid-js';
import { createContext, useContext } from 'solid-js';
import type { ProjectAssignmentResult } from '../core/assignment';
import type {
  Project,
  ProjectDetail,
  ProjectFilters,
  TaskProjectReference,
} from '../core/project';

export type ProjectRow = {
  project: Project;
  properties: readonly Property[];
  /** Submitted from a composer and not yet confirmed; its id may be provisional. */
  pending?: boolean;
};

export type ProjectsSource = {
  rows: Accessor<readonly ProjectRow[] | undefined>;
  loading: Accessor<boolean>;
  error: Accessor<Error | undefined>;
  hasMore: Accessor<boolean>;
  loadingMore: Accessor<boolean>;
  loadMore(): Promise<void>;
  refresh(): Promise<void>;
};

export type ProjectSource = {
  project: Accessor<ProjectDetail | undefined>;
  properties: Accessor<readonly Property[]>;
  loading: Accessor<boolean>;
  error: Accessor<Error | undefined>;
  refresh(): Promise<void>;
};

export type ProjectPropertyDraft = {
  property: Property;
  value: PropertyApiValues;
};

export type ProjectCreationInput = {
  name: string;
  shareWithTeam: boolean;
  properties: readonly ProjectPropertyDraft[];
  /** Set when an earlier attempt created the project; only its properties are saved. */
  createdId?: string;
};

/** A failed request stays distinct from a property failure after the project exists. */
export type ProjectCreationResult =
  | { status: 'created'; id: string }
  | { status: 'failed'; error: Error }
  | { status: 'propertiesFailed'; id: string; error: Error };

/** A creation the server has not settled. `id` is provisional until it is created. */
export type PendingProject = {
  id: string;
  name: string;
  properties: readonly ProjectPropertyDraft[];
  submittedAt: string;
};

/** Capabilities supplied by the production entry point or by a test. */
export type ProjectsContext = {
  userId: Accessor<string | undefined>;
  createCollectionSource(
    filters?: Accessor<ProjectFilters>,
    enabled?: Accessor<boolean>
  ): ProjectsSource;
  createProjectSource(id: Accessor<string>): ProjectSource;
  /** Every composer's in-flight creations, including composers that have closed. */
  createPendingProjectsSource(): {
    projects: Accessor<readonly PendingProject[]>;
  };
  createPropertyDefinitionsSource(): {
    properties: Accessor<readonly Property[]>;
    loading: Accessor<boolean>;
    error: Accessor<Error | undefined>;
  };
  createReferencesSource(ids: Accessor<readonly string[]>): {
    references: Accessor<ReadonlyMap<string, TaskProjectReference>>;
    loading: Accessor<boolean>;
    error: Accessor<Error | undefined>;
  };
  createCommands(): {
    createTask(
      projectId: string,
      ...args: Parameters<typeof createTaskWithProperties>
    ): ReturnType<typeof createTaskWithProperties>;
    pending: Accessor<boolean>;
    /**
     * Lists the project as pending at once, then creates it and saves its
     * properties. Settles only after the server confirms, and never rejects.
     */
    create(input: ProjectCreationInput): Promise<ProjectCreationResult>;
    rename(id: string, name: string): Promise<void>;
    setMembers(id: string, memberIds: string[]): Promise<void>;
    assignTasks(
      projectId: string | undefined,
      taskIds: readonly string[]
    ): Promise<ProjectAssignmentResult[]>;
    delete(id: string): Promise<void>;
    saveProperty(
      id: string,
      property: Property,
      value: PropertyApiValues
    ): Promise<void>;
  };
};

const Context = createContext<ProjectsContext>();

export function ProjectsProvider(
  props: ParentProps<{ context: ProjectsContext }>
) {
  return (
    <Context.Provider value={props.context}>{props.children}</Context.Provider>
  );
}

export function useProjectsContext(): ProjectsContext {
  const context = useContext(Context);
  if (!context) throw new Error('ProjectsProvider is required');
  return context;
}
