import { openEntityInSplit } from '@app/features/activity/open-entity-in-split';
import { ActivityTimelineRow } from '@app/features/activity/views/activity-timeline-row';
import { ProjectChip } from '@app/features/projects/components/project-chip';
import type { ProjectSection } from '@app/features/projects/core/project';
import { projectActivityEvent } from '@app/features/projects/core/project-activity';
import { openProject } from '@app/features/projects/open-project';
import { projectKeys } from '@app/features/projects/queries/keys';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { enableProjects, isFeatureEnabled } from '@core/constant/featureFlags';
import Chat from '@phosphor-icons/core/regular/chat-circle.svg';
import Stack from '@phosphor-icons/core/regular/stack.svg';
import { queryClient } from '@queries/client';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer, type RenderContext } from './ToolRenderer';

type ProjectDetails = NamedTool<'CreateInitiative', 'response'>['data'];
type Comment = NamedTool<'PostInitiativeComment', 'response'>['data'];

async function refreshProjectsAfterMutation(): Promise<void> {
  if (!isFeatureEnabled(enableProjects)) return;
  await queryClient.invalidateQueries({ queryKey: projectKeys._def });
}

function resultCount(count: number, noun: string, more = false): string {
  return `${count}${more ? '+' : ''} ${noun}${count === 1 && !more ? '' : 's'}`;
}

function ProjectLink(props: {
  id: string;
  name?: string;
  discussionId?: string;
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
          name:
            props.name ?? (props.discussionId ? 'Open discussion' : 'Project'),
        }}
        onOpen={(id, event) =>
          openProject(layout, id, {
            discussionId: props.discussionId,
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
  discussionId?: string | null;
  discussion?: boolean;
  section?: ProjectSection;
  children?: JSX.Element;
}) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <BaseTool
      type="call"
      icon={props.discussion ? Chat : Stack}
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
            {(id) => (
              <ProjectLink
                id={id()}
                discussionId={props.discussionId ?? undefined}
                section={props.discussion ? 'overview' : props.section}
              />
            )}
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

function CommentResult(props: { projectId: string; message: Comment }) {
  return (
    <div class="space-y-2 rounded-md border border-edge-muted p-2">
      <Show
        when={!props.message.deleted_at}
        fallback={<p class="text-xs text-ink-muted">Comment deleted</p>}
      >
        <StaticMarkdown markdown={props.message.content} />
      </Show>
      <Show when={props.message.reactions.length > 0}>
        <p class="text-xs text-ink-muted">
          {props.message.reactions
            .map((reaction) => `${reaction.emoji} ${reaction.users.length}`)
            .join(' · ')}
        </p>
      </Show>
      <ProjectLink id={props.projectId} discussionId={props.message.id} />
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
        status={ctx.response?.data.success ? 'Deleted' : undefined}
      >
        <p class="text-xs text-ink-muted">Project deleted.</p>
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
  SetTaskInitiative: createToolRenderer({
    name: 'SetTaskInitiative',
    handleResponse: refreshProjectsAfterMutation,
    render: (ctx) => (
      <ProjectToolCard
        label={
          ctx.tool.data.initiativeId ? 'Set task project' : 'Clear task project'
        }
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        result={ctx.response?.data}
        projectId={ctx.tool.data.initiativeId}
        status={resultCount(ctx.response?.data.results.length ?? 0, 'task')}
      >
        <Tool.List>
          <For each={ctx.response?.data.results}>
            {(outcome, index) => (
              <Tool.ListItem>
                Task {index() + 1}:{' '}
                {outcome.status
                  .replace(/([a-z])([A-Z])/g, '$1 $2')
                  .toLowerCase()}
              </Tool.ListItem>
            )}
          </For>
        </Tool.List>
      </ProjectToolCard>
    ),
  }),
  ReadTaskInitiatives: createToolRenderer({
    name: 'ReadTaskInitiatives',
    render: (ctx) => (
      <ProjectToolCard
        label="Read task projects"
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        result={ctx.response?.data}
        status={resultCount(ctx.response?.data.references.length ?? 0, 'task')}
      >
        <Tool.List>
          <For each={ctx.response?.data.references}>
            {(reference, index) => (
              <Tool.ListItem>
                <div class="flex items-center gap-2">
                  <span>Task {index() + 1}</span>
                  <Show
                    when={reference.state === 'visible' ? reference : undefined}
                    fallback={
                      <span>
                        {reference.state === 'unavailable'
                          ? 'Unavailable project'
                          : 'No project'}
                      </span>
                    }
                  >
                    {(project) => (
                      <ProjectLink
                        id={project().initiativeId}
                        name={project().name}
                      />
                    )}
                  </Show>
                </div>
              </Tool.ListItem>
            )}
          </For>
        </Tool.List>
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
  ReadInitiativeDiscussions: createToolRenderer({
    name: 'ReadInitiativeDiscussions',
    render: (ctx) => {
      const messages = () => {
        const result = ctx.response?.data;
        return result?.type === 'thread'
          ? [result.thread.root, ...result.thread.replies]
          : result?.type === 'timeline'
            ? result.discussions
            : [];
      };
      return (
        <ProjectToolCard
          label="Read project discussions"
          discussion
          renderContext={ctx.renderContext}
          hasResult={!!ctx.response}
          result={ctx.response?.data}
          projectId={ctx.tool.data.initiativeId}
          discussionId={ctx.tool.data.threadId}
          status={resultCount(
            messages().length,
            'comment',
            ctx.response?.data.type === 'timeline' &&
              ctx.response.data.truncated
          )}
        >
          <Show
            when={messages().length}
            fallback={
              <p class="text-xs text-ink-muted">No matching discussions.</p>
            }
          >
            <For each={messages()}>
              {(message) => (
                <CommentResult
                  projectId={ctx.tool.data.initiativeId}
                  message={message}
                />
              )}
            </For>
          </Show>
        </ProjectToolCard>
      );
    },
  }),
  PostInitiativeComment: createToolRenderer({
    name: 'PostInitiativeComment',
    handleResponse: refreshProjectsAfterMutation,
    render: (ctx) => (
      <ProjectToolCard
        label={
          ctx.tool.data.threadId
            ? 'Reply to project discussion'
            : 'Comment on project'
        }
        discussion
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        result={ctx.response?.data}
        projectId={ctx.tool.data.initiativeId}
        discussionId={ctx.response?.data.id ?? ctx.tool.data.threadId}
      >
        <Show when={ctx.response?.data}>
          {(message) => (
            <CommentResult
              projectId={ctx.tool.data.initiativeId}
              message={message()}
            />
          )}
        </Show>
      </ProjectToolCard>
    ),
  }),
  UpdateInitiativeComment: createToolRenderer({
    name: 'UpdateInitiativeComment',
    handleResponse: refreshProjectsAfterMutation,
    render: (ctx) => (
      <ProjectToolCard
        label="Edit project comment"
        discussion
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        result={ctx.response?.data}
        projectId={ctx.tool.data.initiativeId}
        discussionId={ctx.tool.data.messageId}
      >
        <Show when={ctx.response?.data}>
          {(message) => (
            <CommentResult
              projectId={ctx.tool.data.initiativeId}
              message={message()}
            />
          )}
        </Show>
      </ProjectToolCard>
    ),
  }),
  DeleteInitiativeComment: createToolRenderer({
    name: 'DeleteInitiativeComment',
    handleResponse: refreshProjectsAfterMutation,
    render: (ctx) => (
      <ProjectToolCard
        label={
          ctx.tool.data.wholeDiscussion
            ? 'Delete project discussion'
            : 'Delete project comment'
        }
        discussion
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        result={ctx.response?.data}
        projectId={ctx.tool.data.initiativeId}
        status={ctx.response?.data.success ? 'Deleted' : undefined}
      >
        <p class="text-xs text-ink-muted">
          {ctx.tool.data.wholeDiscussion
            ? 'Discussion deleted.'
            : 'Comment deleted.'}
        </p>
      </ProjectToolCard>
    ),
  }),
  ReactToInitiativeComment: createToolRenderer({
    name: 'ReactToInitiativeComment',
    handleResponse: refreshProjectsAfterMutation,
    render: (ctx) => (
      <ProjectToolCard
        label={`${ctx.tool.data.add ? 'Add' : 'Remove'} ${ctx.tool.data.emoji} reaction`}
        discussion
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        result={ctx.response?.data}
        projectId={ctx.tool.data.initiativeId}
        discussionId={ctx.tool.data.messageId}
      >
        <Show when={ctx.response?.data}>
          {(message) => (
            <CommentResult
              projectId={ctx.tool.data.initiativeId}
              message={message()}
            />
          )}
        </Show>
      </ProjectToolCard>
    ),
  }),
  SetInitiativeDiscussionResolved: createToolRenderer({
    name: 'SetInitiativeDiscussionResolved',
    handleResponse: refreshProjectsAfterMutation,
    render: (ctx) => (
      <ProjectToolCard
        label={
          ctx.tool.data.resolved
            ? 'Resolve project discussion'
            : 'Reopen project discussion'
        }
        discussion
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        result={ctx.response?.data}
        projectId={ctx.tool.data.initiativeId}
        discussionId={ctx.tool.data.threadId}
        status={
          ctx.response
            ? ctx.response.data.resolved
              ? 'Resolved'
              : 'Reopened'
            : undefined
        }
      >
        <p class="text-xs text-ink-muted">
          Discussion {ctx.response?.data.resolved ? 'resolved' : 'reopened'}.
        </p>
      </ProjectToolCard>
    ),
  }),
};
