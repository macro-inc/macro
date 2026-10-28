import type { createTaskWithProperties } from '@block-md/util/taskComposerProperties';
import type { Property, PropertyApiValues } from '@property/types';
import type { Accessor, ParentProps } from 'solid-js';
import { createContext, useContext } from 'solid-js';
import type { ProjectAssignmentResult } from '../core/assignment';
import type { Project, ProjectDetail, ProjectFilters } from '../core/project';

export type ProjectRow = {
  project: Project;
  properties: readonly Property[];
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
  /** Markdown that seeds the description surface. */
  description: string;
  shareWithTeam: boolean;
  properties: readonly ProjectPropertyDraft[];
};

/** Capabilities supplied by the production entry point or by a test. */
export type ProjectsContext = {
  userId: Accessor<string | undefined>;
  createCollectionSource(
    filters?: Accessor<ProjectFilters>,
    enabled?: Accessor<boolean>
  ): ProjectsSource;
  createProjectSource(id: Accessor<string>): ProjectSource;
  createPropertyDefinitionsSource(): {
    properties: Accessor<readonly Property[]>;
    loading: Accessor<boolean>;
    error: Accessor<Error | undefined>;
  };
  createCommands(): {
    /** One request creates the task with its Project property set. */
    createTask(
      projectId: string,
      ...args: Parameters<typeof createTaskWithProperties>
    ): ReturnType<typeof createTaskWithProperties>;
    pending: Accessor<boolean>;
    /** One request creates the project with its property values. */
    create(input: ProjectCreationInput): Promise<ProjectDetail>;
    rename(id: string, name: string): Promise<void>;
    setMembers(id: string, memberIds: string[]): Promise<void>;
    /** Sets or, without a project, clears each task's Project property. */
    assignTasks(
      projectId: string | undefined,
      taskIds: readonly string[]
    ): Promise<ProjectAssignmentResult[]>;
    delete(id: string): Promise<void>;
    /** Deletes each project and refreshes once; resolves with the ids that failed. */
    deleteMany(ids: readonly string[]): Promise<string[]>;
    saveProperty(
      id: string,
      property: Property,
      value: PropertyApiValues
    ): Promise<void>;
    /** Saves every value as one batch; rejects when any of them fails. */
    saveProperties(
      updates: readonly (ProjectPropertyDraft & { id: string })[]
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
