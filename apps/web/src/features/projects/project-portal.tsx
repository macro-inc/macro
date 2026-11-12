/**
 * Project client portal: read-only view for clients without accounts.
 * Unauthenticated users can view table and board views of project tasks
 * when the project has public link sharing enabled.
 */

import { TasksContent } from '@app/features/tasks-view/tasks-content';
import { TasksViewProvider } from '@app/features/tasks-view/tasks-view-context';
import { useUserId } from '@core/context/user';
import { thrownResultErrorHasCode } from '@core/util/result';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import StackIcon from '@phosphor/stack.svg';
import { PropertyValuePill } from '@property/component/PropertyValuePill';
import type { Property } from '@property/types';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { InitiativeDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { mapInitiativeDetail } from '@service-storage/initiative';
import { Button, Layer } from '@ui';
import { type Client, CombinedError } from '@urql/core';
import {
  type Accessor,
  createMemo,
  createSignal,
  ErrorBoundary,
  For,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';

import {
  type ProjectSource,
  type ProjectsContext,
  ProjectsProvider,
} from './context/projects-context';
import type { ProjectDetail, ProjectSection } from './core/project';
import { toProjectDetail } from './queries/project-model';
import {
  projectDefinitionProperties,
  projectProperties,
} from './queries/project-properties';
import { createProjectTasksDataSource } from './queries/project-tasks';

const accessLost = (error: unknown) =>
  ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND'].some(
    (code) =>
      thrownResultErrorHasCode(error, code) ||
      (error instanceof CombinedError &&
        error.graphQLErrors.some((error) => error.extensions.code === code))
  );

const projectDetailData = (
  project: ReturnType<typeof mapInitiativeDetail>
) => ({
  project: toProjectDetail(project),
  properties: projectProperties(project.properties),
});

function createPortalProjectDetailQuery(
  client: () => Client,
  projectId: Accessor<string>,
  enabled: Accessor<boolean> = () => true
) {
  const active = () => enabled() && Boolean(projectId());
  const query = createLiveQuery(
    InitiativeDocument,
    () => (active() ? { initiativeId: projectId() } : undefined),
    () => ({
      client: client(),
      requestPolicy: 'cache-and-network',
      keepPreviousData: false,
      select: (data) => ({
        viewerId: data.user.id,
        detail: projectDetailData(mapInitiativeDetail(data.user.initiative)),
      }),
    })
  );
  const data = createMemo(() => {
    const result = query.data;
    if (!active() || !result) return undefined;
    return result.detail;
  });
  return {
    get data() {
      return data();
    },
    get error() {
      return active() ? query.error : null;
    },
    get isSuccess() {
      return active() && query.isSuccess;
    },
    get isPending() {
      return !active() || query.isPending;
    },
    get isError() {
      return active() && query.isError;
    },
    refetch: query.refetch,
  };
}

function createPortalProjectSource(id: Accessor<string>): ProjectSource {
  const query = createPortalProjectDetailQuery(
    getGraphqlSoupClient,
    id,
    () => true
  );
  return {
    project: () =>
      query.isPending || accessLost(query.error)
        ? undefined
        : query.data?.project,
    properties: () =>
      query.isPending || accessLost(query.error)
        ? []
        : (query.data?.properties ?? []),
    loading: () => query.isPending,
    error: () => query.error ?? undefined,
    refresh: async () => {
      await query.refetch({ requestPolicy: 'cache-and-network' });
    },
  };
}

function createPortalProjectsContext(): ProjectsContext {
  const userId = useUserId();
  const context: ProjectsContext = {
    userId,
    createPropertyDefinitionsSource() {
      const definitions = useListPropertiesQuery(() => ({
        scope: 'system',
        includeOptions: true,
      }));
      return {
        loading: () => definitions.isPending,
        error: () => definitions.error ?? undefined,
        properties: () =>
          definitions.isPending
            ? []
            : projectDefinitionProperties(definitions.data ?? []),
      };
    },
    createCollectionSource() {
      return {
        rows: () => [],
        loading: () => false,
        error: () => undefined,
        hasMore: () => false,
        loadingMore: () => false,
        loadMore: async () => {},
        refresh: async () => {},
      };
    },
    createProjectSource(id) {
      return createPortalProjectSource(id);
    },
    createCommands() {
      return {
        createTask: () => {
          throw new Error('Read-only portal');
        },
        pending: () => false,
        create: async () => {
          throw new Error('Read-only portal');
        },
        rename: async () => {
          throw new Error('Read-only portal');
        },
        setMembers: async () => {
          throw new Error('Read-only portal');
        },
        assignTasks: async () => {
          throw new Error('Read-only portal');
        },
        delete: async () => {
          throw new Error('Read-only portal');
        },
        deleteMany: async () => {
          throw new Error('Read-only portal');
        },
        saveProperty: async () => {
          throw new Error('Read-only portal');
        },
        saveProperties: async () => {
          throw new Error('Read-only portal');
        },
      };
    },
  };
  return context;
}

function PortalTasksList(props: { projectId: string; projectName: string }) {
  const source = createPortalProjectSource(() => props.projectId);
  return (
    <TasksViewProvider
      initialState={{ tab: 'team-tasks', groupBy: 'status', facets: {} }}
      restoreEntryState={false}
      scopeKey={`portal:initiative:${props.projectId}:tasks`}
      searchNamespace="portalProjectTasks"
      onOpenTask={() => false}
      onCloseTask={() => {}}
      sourceFactory={(state, options) =>
        createProjectTasksDataSource(props.projectId, source, state, options)
      }
    >
      <div class="flex size-full min-h-0 flex-col px-4 py-2">
        <TasksContent />
      </div>
    </TasksViewProvider>
  );
}

function PortalFooter() {
  return (
    <footer class="mx-auto flex w-full max-w-[680px] flex-col gap-1 px-4 pb-8 text-center text-[11px] text-ink-muted">
      <p>
        Powered by{' '}
        <a href="https://macro.com" class="hover:underline">
          Macro
        </a>
      </p>
    </footer>
  );
}

function PortalHeader(props: { project: ProjectDetail }) {
  return (
    <header class="sticky top-0 z-10 border-b border-ink-faint/50 bg-canvas-base/95 px-6 py-4 backdrop-blur-sm">
      <div class="mx-auto flex max-w-5xl items-center gap-3">
        <div class="flex size-8 items-center justify-center rounded-md bg-accent/10 text-accent">
          <StackIcon class="size-4" />
        </div>
        <h1 class="truncate text-lg font-semibold">{props.project.name}</h1>
      </div>
    </header>
  );
}

function PortalProperties(props: { properties: readonly Property[] }) {
  return (
    <Show when={props.properties.length > 0}>
      <div
        class="mb-6 flex flex-wrap items-center gap-2"
        aria-label="Project properties"
      >
        <For each={props.properties}>
          {(property) => (
            <PropertyValuePill
              property={property}
              canEdit={false}
              onRefresh={() => {}}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

function ProjectPortalContent(props: { projectId: string }) {
  const context = createPortalProjectsContext();
  const source = context.createProjectSource(() => props.projectId);
  const [section, setSection] = createSignal<ProjectSection>('tasks');

  return (
    <ProjectsProvider context={context}>
      <Layer depth={1}>
        <main class="flex h-full min-h-0 flex-col overflow-hidden bg-canvas-base text-ink">
          <Show
            when={source.project()}
            fallback={
              <Show
                when={source.error()}
                fallback={
                  <div class="flex h-full items-center justify-center">
                    <div class="text-ink-muted">Loading project…</div>
                  </div>
                }
              >
                {(error) => (
                  <div class="mx-auto flex max-w-[680px] flex-col px-4 py-16">
                    <div role="alert" class="text-center">
                      <h2 class="mb-2 text-lg font-semibold">
                        Project unavailable
                      </h2>
                      <p class="text-ink-muted">
                        {accessLost(error())
                          ? 'This project may be private, or the link may have expired.'
                          : 'Could not load the project. Please try again.'}
                      </p>
                      <Button
                        class="mt-4"
                        onClick={() => void source.refresh()}
                      >
                        Try again
                      </Button>
                    </div>
                  </div>
                )}
              </Show>
            }
          >
            {(project) => (
              <>
                <PortalHeader project={project()} />
                <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <nav class="mx-auto w-full max-w-5xl border-b border-ink-faint/50 px-6">
                    <div class="flex gap-4">
                      <button
                        type="button"
                        class="border-b-2 px-1 py-3 text-sm font-medium transition-colors"
                        classList={{
                          'border-accent text-accent': section() === 'overview',
                          'border-transparent text-ink-muted hover:text-ink':
                            section() !== 'overview',
                        }}
                        onClick={() => setSection('overview')}
                      >
                        Overview
                      </button>
                      <button
                        type="button"
                        class="border-b-2 px-1 py-3 text-sm font-medium transition-colors"
                        classList={{
                          'border-accent text-accent': section() === 'tasks',
                          'border-transparent text-ink-muted hover:text-ink':
                            section() !== 'tasks',
                        }}
                        onClick={() => setSection('tasks')}
                      >
                        Tasks
                      </button>
                    </div>
                  </nav>
                  <div class="min-h-0 flex-1 overflow-y-auto">
                    <Switch>
                      <Match when={section() === 'overview'}>
                        <div class="mx-auto max-w-3xl px-6 py-8">
                          <h2 class="mb-6 text-2xl font-semibold">
                            {project().name}
                          </h2>
                          <PortalProperties properties={source.properties()} />
                          <div class="prose prose-sm max-w-none text-ink-muted">
                            <p>
                              View the project tasks by clicking the Tasks tab
                              above.
                            </p>
                          </div>
                        </div>
                      </Match>
                      <Match when={section() === 'tasks'}>
                        <div class="h-full">
                          <PortalTasksList
                            projectId={project().id}
                            projectName={project().name}
                          />
                        </div>
                      </Match>
                    </Switch>
                  </div>
                </div>
                <PortalFooter />
              </>
            )}
          </Show>
        </main>
      </Layer>
    </ProjectsProvider>
  );
}

export function ProjectPortalPage(props: { projectId: string }) {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <div class="flex h-full items-center justify-center bg-canvas-base">
          <div class="text-center">
            <h2 class="mb-2 text-lg font-semibold text-ink">
              Something went wrong
            </h2>
            <p class="mb-4 text-ink-muted">
              Could not load the project portal.
            </p>
            <Button onClick={reset}>Try again</Button>
          </div>
        </div>
      )}
    >
      <Suspense
        fallback={
          <div class="flex h-full items-center justify-center bg-canvas-base">
            <div class="text-ink-muted">Loading…</div>
          </div>
        }
      >
        <ProjectPortalContent projectId={props.projectId} />
      </Suspense>
    </ErrorBoundary>
  );
}
