import { openEntityInSplit } from '@app/features/activity/open-entity-in-split';
import { ActivityTimelineRow } from '@app/features/activity/views/activity-timeline-row';
import { ProjectChip } from '@app/features/projects/components/project-chip';
import type { ProjectSection } from '@app/features/projects/core/project';
import { projectActivityEvent } from '@app/features/projects/core/project-activity';
import { openProject } from '@app/features/projects/open-project';
import { refreshProjectQueries } from '@app/features/projects/queries/project-revalidation';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { enableProjects, isFeatureEnabled } from '@core/constant/featureFlags';
import Stack from '@phosphor-icons/core/regular/stack.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer, type RenderContext } from './ToolRenderer';

type ProjectDetails = NamedTool<'CreateInitiative', 'response'>['data'];

async function refreshProjectsAfterMutation(): Promise<void> {
  if (!isFeatureEnabled(enableProjects)) return;
  await refreshProjectQueries();
}

function resultCount(count: number, noun: string, more = false): string {
  return `${count}${more ? '+' : ''} ${noun}${count === 1 && !more ? '' : 's'}`;
}

function ProjectLink(props: {
  id: string;
  name?: string;
  section?: ProjectSection;
}) {
  const layout = useSplitLayout();
  const projectsFlag = useFeatureFlag(enableProjects);
  return (
    <Show when={projectsFlag().enabled} fallback={<span>{props.name}</span>}>
      <ProjectChip
        reference={{
          state: 'visible',
          id: props.id,
          name: props.name ?? 'Project',
        }}
        onOpen={(id, event) =>
          openProject(layout, id, {
            section: props.section,
            newSplit: event.shiftKey,
          })
        }
      />
    </Show>
  );
}

/** Every response remains inspectable, including empty results and partial batch outcomes. */
function ProjectToolCard(props: {
  label: string;
  status?: string;
  renderContext: RenderContext['renderContext'];
  result?: unknown;
  hasResult: boolean;
  projectId?: string | null;
  section?: ProjectSection;
  children?: JSX.Element;
}) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <BaseTool
      type="call"
      icon={Stack}
      renderContext={props.renderContext}
      response={
        props.hasResult && expanded() ? (
          <StaticMarkdownContext>
            <div class="max-h-96 space-y-3 overflow-y-auto">
              {props.children}
              <details class="text-xs">
                <summary class="select-none text-ink-muted">
                  Result data
                </summary>
                <pre class="mt-2 whitespace-pre-wrap break-all rounded-md bg-surface-2 p-2 text-ink-muted">
                  {JSON.stringify(props.result, null, 2)}
                </pre>
              </details>
            </div>
          </StaticMarkdownContext>
        ) : undefined
      }
    >
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate">{props.label}</span>
          <Show when={props.projectId}>
            {(id) => <ProjectLink id={id()} section={props.section} />}
          </Show>
        </div>
        <Tool.ResultToggle
          expanded={expanded()}
          onToggle={() => setExpanded((value) => !value)}
          showToggle={props.hasResult}
          status={props.hasResult ? (props.status ?? 'Done') : undefined}
        />
      </div>
    </BaseTool>
  );
}

function ProjectDetailsResult(props: { project: ProjectDetails }) {
  return (
    <div class="space-y-2">
      <ProjectLink id={props.project.initiativeId} name={props.project.name} />
      <p class="text-xs text-ink-muted">
        {props.project.taskCount} tasks · {props.project.memberIds.length}{' '}
        members · {props.project.access} access
      </p>
      <p class="text-xs text-ink-muted">
        Team sharing: {props.project.teamAccess ?? 'off'} · Link sharing:{' '}
        {props.project.linkScope
          ? `${props.project.linkScope.toLowerCase()} (${props.project.linkAccess ?? 'view'})`
          : 'off'}
      </p>
    </div>
  );
}

export const initiativeToolHandlers = {
  ListInitiatives: createToolRenderer({
    name: 'ListInitiatives',
    render: (ctx) => (
      <ProjectToolCard
        label="Find projects"
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        result={ctx.response?.data}
        status={resultCount(
          ctx.response?.data.projects.length ?? 0,
          'project',
          ctx.response?.data.truncated
        )}
      >
        <Show
          when={ctx.response?.data.projects.length}
          fallback={<p class="text-xs text-ink-muted">No matching projects.</p>}
        >
          <Tool.List>
            <For each={ctx.response?.data.projects}>
              {(project) => (
                <Tool.ListItem>
                  <div class="flex items-center justify-between gap-2">
                    <ProjectLink
                      id={project.initiativeId}
                      name={project.name}
                    />
                    <span class="shrink-0 text-ink-muted">
                      {project.completedTaskCount}/{project.taskCount} tasks
                      done
                    </span>
                  </div>
                </Tool.ListItem>
              )}
            </For>
          </Tool.List>
        </Show>
      </ProjectToolCard>
    ),
  }),
  ReadInitiative: createToolRenderer({
    name: 'ReadInitiative',
    render: (ctx) => (
      <ProjectToolCard
        label="Read project"
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        result={ctx.response?.data}
        projectId={ctx.tool.data.initiativeId}
      >
        <Show when={ctx.response?.data.project}>
          {(project) => <ProjectDetailsResult project={project()} />}
        </Show>
      </ProjectToolCard>
    ),
  }),
  CreateInitiative: createToolRenderer({
    name: 'CreateInitiative',
    handleResponse: refreshProjectsAfterMutation,
    render: (ctx) => (
      <ProjectToolCard
        label={`Create project ${ctx.tool.data.name}`}
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        result={ctx.response?.data}
      >
        <Show when={ctx.response?.data}>
          {(project) => <ProjectDetailsResult project={project()} />}
        </Show>
      </ProjectToolCard>
    ),
  }),
  UpdateInitiative: createToolRenderer({
    name: 'UpdateInitiative',
    handleResponse: refreshProjectsAfterMutation,
    render: (ctx) => (
      <ProjectToolCard
        label="Update project"
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        result={ctx.response?.data}
        projectId={ctx.tool.data.initiativeId}
      >
        <Show when={ctx.response?.data}>
          {(project) => <ProjectDetailsResult project={project()} />}
        </Show>
      </ProjectToolCard>
    ),
  }),
  DeleteInitiative: createToolRenderer({
    name: 'DeleteInitiative',
    handleResponse: refreshProjectsAfterMutation,
    render: (ctx) => (
      <ProjectToolCard
        label="Delete project"
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        result={ctx.response?.data}
        status={
          ctx.response
            ? ctx.response.data.success
              ? 'Deleted'
              : 'Not deleted'
            : undefined
        }
      >
        <p class="text-xs text-ink-muted">
          {ctx.response?.data.success
            ? 'Project deleted.'
            : 'Project could not be deleted.'}
        </p>
      </ProjectToolCard>
    ),
  }),
  UpdateInitiativeSharing: createToolRenderer({
    name: 'UpdateInitiativeSharing',
    handleResponse: refreshProjectsAfterMutation,
    render: (ctx) => (
      <ProjectToolCard
        label="Update project sharing"
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        result={ctx.response?.data}
        projectId={ctx.tool.data.initiativeId}
      >
        <Show when={ctx.response?.data}>
          {(project) => <ProjectDetailsResult project={project()} />}
        </Show>
      </ProjectToolCard>
    ),
  }),
  ReadInitiativeActivity: createToolRenderer({
    name: 'ReadInitiativeActivity',
    render: (ctx) => (
      <ProjectToolCard
        label="Read project activity"
        section="overview"
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        result={ctx.response?.data}
        projectId={ctx.tool.data.initiativeId}
        status={resultCount(
          ctx.response?.data.records.length ?? 0,
          'change',
          ctx.response?.data.truncated
        )}
      >
        <Show
          when={ctx.response?.data.records.length}
          fallback={<p class="text-xs text-ink-muted">No matching activity.</p>}
        >
          <For each={ctx.response?.data.records}>
            {(record) => (
              <ActivityTimelineRow
                entry={{
                  kind: 'single',
                  event: projectActivityEvent(
                    ctx.tool.data.initiativeId,
                    record
                  ),
                }}
                showActor={false}
                onOpen={openEntityInSplit}
              />
            )}
          </For>
        </Show>
      </ProjectToolCard>
    ),
  }),
};
