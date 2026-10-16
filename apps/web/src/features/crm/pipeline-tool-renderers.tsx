import { BaseTool } from '@core/component/AI/component/tool/BaseTool';
import { createToolRenderer } from '@core/component/AI/component/tool/ToolRenderer';
import Kanban from '@phosphor-icons/core/regular/kanban.svg';
import { queryClient } from '@queries/client';
import { Show } from 'solid-js';
import { pluralize } from './components/tool-companies';
import {
  PipelineEntriesToolResponse,
  PipelinesToolResponse,
  recordName,
  UpdatedEntriesToolResponse,
} from './components/tool-pipelines';
import { crmKeys } from './queries/keys';

/** New, renamed, re-shared or reshaped pipelines show in the sidebar now. */
async function refreshPipelines() {
  await queryClient.invalidateQueries({ queryKey: crmKeys.pipelines._def });
}

function Status(props: { text?: string }) {
  return (
    <Show when={props.text}>
      {(text) => (
        <span class="shrink-0 whitespace-nowrap text-xs text-ink-extra-muted">
          {text()}
        </span>
      )}
    </Show>
  );
}

function Label(props: { children: string; status?: string }) {
  return (
    <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
      <span class="min-w-0 truncate">{props.children}</span>
      <Status text={props.status} />
    </div>
  );
}

const listPipelinesHandler = createToolRenderer({
  name: 'ListPipelines',
  render: (ctx) => (
    <BaseTool
      icon={Kanban}
      renderContext={ctx.renderContext}
      type="call"
      response={
        ctx.response ? (
          <PipelinesToolResponse pipelines={ctx.response.data.pipelines} />
        ) : undefined
      }
    >
      <Label
        status={
          ctx.response
            ? pluralize(ctx.response.data.pipelines.length, 'pipeline')
            : undefined
        }
      >
        List CRM pipelines
      </Label>
    </BaseTool>
  ),
});

const findPipelineEntriesHandler = createToolRenderer({
  name: 'FindPipelineEntries',
  render: (ctx) => {
    const groups = () => ctx.response?.data.pipelines ?? [];
    const target = () =>
      groups().length === 1 ? ` in ${groups()[0]?.pipelineName}` : '';
    return (
      <BaseTool
        icon={Kanban}
        renderContext={ctx.renderContext}
        type="call"
        response={
          ctx.response ? (
            <PipelineEntriesToolResponse
              entries={groups().flatMap((group) => group.entries)}
              empty="No matching entries."
            />
          ) : undefined
        }
      >
        <Label
          status={
            ctx.response
              ? pluralize(ctx.response.data.matched, 'entry', 'entries')
              : undefined
          }
        >
          {`Find pipeline entries${target()}${
            ctx.tool.data.search ? ` matching "${ctx.tool.data.search}"` : ''
          }`}
        </Label>
      </BaseTool>
    );
  },
});

const addToPipelineHandler = createToolRenderer({
  name: 'AddToPipeline',
  render: (ctx) => {
    const added = () => ctx.response?.data.added ?? [];
    return (
      <BaseTool
        icon={Kanban}
        renderContext={ctx.renderContext}
        type="call"
        response={
          ctx.response ? (
            <PipelineEntriesToolResponse
              entries={added()}
              empty="Nothing added."
              noted={{
                entries: ctx.response.data.alreadyPresent ?? [],
                note: 'Already in pipeline',
              }}
            />
          ) : undefined
        }
      >
        <Label
          status={
            ctx.response
              ? `${pluralize(added().length, 'entry', 'entries')} added`
              : undefined
          }
        >
          {ctx.response
            ? `Added ${
                added()
                  .map((entry) => recordName(entry.record))
                  .join(', ') || 'nothing'
              } to pipeline`
            : `Add ${pluralize(ctx.tool.data.entries.length, 'record')} to pipeline`}
        </Label>
      </BaseTool>
    );
  },
});

const updatePipelineEntriesHandler = createToolRenderer({
  name: 'UpdatePipelineEntries',
  render: (ctx) => (
    <BaseTool
      icon={Kanban}
      renderContext={ctx.renderContext}
      type="call"
      response={
        ctx.response ? (
          <UpdatedEntriesToolResponse updated={ctx.response.data.updated} />
        ) : undefined
      }
    >
      <Label
        status={
          ctx.response
            ? pluralize(ctx.response.data.updated.length, 'entry', 'entries')
            : undefined
        }
      >
        {ctx.response ? 'Updated pipeline entries' : 'Update pipeline entries'}
      </Label>
    </BaseTool>
  ),
});

const removeFromPipelineHandler = createToolRenderer({
  name: 'RemoveFromPipeline',
  render: (ctx) => (
    <BaseTool
      icon={Kanban}
      renderContext={ctx.renderContext}
      type="call"
      response={
        ctx.response ? (
          <PipelineEntriesToolResponse
            entries={ctx.response.data.removed}
            empty="Nothing removed."
          />
        ) : undefined
      }
    >
      <Label
        status={
          ctx.response
            ? `${pluralize(ctx.response.data.removed.length, 'entry', 'entries')} removed`
            : undefined
        }
      >
        {ctx.response ? 'Removed from pipeline' : 'Remove from pipeline'}
      </Label>
    </BaseTool>
  ),
});

const createPipelineHandler = createToolRenderer({
  name: 'CreatePipeline',
  handleResponse: refreshPipelines,
  render: (ctx) => (
    <BaseTool
      icon={Kanban}
      renderContext={ctx.renderContext}
      type="call"
      response={
        ctx.response ? (
          <PipelinesToolResponse pipelines={[ctx.response.data.pipeline]} />
        ) : undefined
      }
    >
      <Label>
        {`${ctx.response ? 'Created' : 'Create'} pipeline ${ctx.tool.data.name}`}
      </Label>
    </BaseTool>
  ),
});

const editPipelineHandler = createToolRenderer({
  name: 'EditPipeline',
  handleResponse: refreshPipelines,
  render: (ctx) => (
    <BaseTool
      icon={Kanban}
      renderContext={ctx.renderContext}
      type="call"
      response={
        ctx.response ? (
          <PipelinesToolResponse pipelines={[ctx.response.data.pipeline]} />
        ) : undefined
      }
    >
      <Label>
        {ctx.response
          ? `Updated pipeline ${ctx.response.data.pipeline.name}`
          : 'Edit pipeline'}
      </Label>
    </BaseTool>
  ),
});

export const pipelineToolHandlers = {
  ListPipelines: listPipelinesHandler,
  FindPipelineEntries: findPipelineEntriesHandler,
  AddToPipeline: addToPipelineHandler,
  UpdatePipelineEntries: updatePipelineEntriesHandler,
  RemoveFromPipeline: removeFromPipelineHandler,
  CreatePipeline: createPipelineHandler,
  EditPipeline: editPipelineHandler,
};
