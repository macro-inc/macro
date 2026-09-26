import type { TaskEntityWithProperties } from '@entity';
import type { Property, PropertyApiValues } from '@property/types';
import type { Accessor, ParentProps } from 'solid-js';
import { createContext, useContext } from 'solid-js';
import type {
  Project,
  ProjectDetail,
  ProjectFilters,
  ProjectSharingPatch,
  TaskProjectReference,
} from '../core/project';

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

export type ProjectTasksSource = {
  tasks: Accessor<readonly TaskEntityWithProperties[]>;
  loading: Accessor<boolean>;
  error: Accessor<Error | undefined>;
  hasMore: Accessor<boolean>;
  loadingMore: Accessor<boolean>;
  loadMore(): Promise<void>;
};

export type ProjectPropertyDraft = {
  property: Property;
  value: PropertyApiValues;
};

export type { ProjectAssignmentResult } from '../core/assignment';

import type { ProjectAssignmentResult } from '../core/assignment';

/** Capabilities supplied by the production entry point or by a test. */
export type ProjectsContext = {
  userId: Accessor<string | undefined>;
  createCollectionSource(
    filters?: Accessor<ProjectFilters>,
    enabled?: Accessor<boolean>
  ): ProjectsSource;
  createProjectSource(id: Accessor<string>): ProjectSource;
  createChannelNamesSource(
    ids: Accessor<readonly string[]>
  ): Accessor<ReadonlyMap<string, string>>;
  createPropertyDefinitionsSource(): {
    properties: Accessor<readonly Property[]>;
    loading: Accessor<boolean>;
    error: Accessor<Error | undefined>;
  };
  createTasksSource(id: Accessor<string>): ProjectTasksSource;
  createReferencesSource(ids: Accessor<readonly string[]>): {
    references: Accessor<ReadonlyMap<string, TaskProjectReference>>;
    loading: Accessor<boolean>;
    error: Accessor<Error | undefined>;
  };
  createCommands(): {
    pending: Accessor<boolean>;
    create(input: {
      name: string;
      shareWithTeam: boolean;
    }): Promise<ProjectDetail>;
    rename(id: string, name: string): Promise<void>;
    share(id: string, sharing: ProjectSharingPatch): Promise<void>;
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
