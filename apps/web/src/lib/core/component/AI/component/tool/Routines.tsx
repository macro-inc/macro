import Clock from '@phosphor-icons/core/regular/clock.svg';
import { invalidateSchedules } from '@queries/agent-schedule/schedules';
import { createSignal } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer, type RenderContext } from './ToolRenderer';

function RoutineResult(props: {
  label: string;
  summary?: string;
  result: unknown;
  renderContext: RenderContext['renderContext'];
}) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <BaseTool
      icon={Clock}
      renderContext={props.renderContext}
      type="call"
      response={
        expanded() && props.result !== undefined ? (
          <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 text-xs">
            {JSON.stringify(props.result, null, 2)}
          </pre>
        ) : undefined
      }
    >
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span class="min-w-0 truncate">{props.label}</span>
        <Tool.ResultToggle
          expanded={expanded()}
          onToggle={() => setExpanded(!expanded())}
          showToggle={props.result !== undefined}
          status={props.summary}
        />
      </div>
    </BaseTool>
  );
}

export const createRoutineHandler = createToolRenderer({
  name: 'CreateRoutine',
  handleResponse: async () => {
    await invalidateSchedules();
  },
  render: (ctx) => (
    <RoutineResult
      label={ctx.response ? 'Created routine' : 'Create routine'}
      summary={ctx.response?.data.name ?? ctx.tool.data.configuration.name}
      result={ctx.response?.data}
      renderContext={ctx.renderContext}
    />
  ),
});
export const listRoutinesHandler = createToolRenderer({
  name: 'ListRoutines',
  render: (ctx) => (
    <RoutineResult
      label="Read routines"
      summary={ctx.response ? `${ctx.response.data.total} routines` : undefined}
      result={ctx.response?.data}
      renderContext={ctx.renderContext}
    />
  ),
});
export const readRoutineHandler = createToolRenderer({
  name: 'ReadRoutine',
  render: (ctx) => (
    <RoutineResult
      label="Read routine and runs"
      summary={ctx.response?.data.routine.name}
      result={ctx.response?.data}
      renderContext={ctx.renderContext}
    />
  ),
});
export const updateRoutineHandler = createToolRenderer({
  name: 'UpdateRoutine',
  handleResponse: async () => {
    await invalidateSchedules();
  },
  render: (ctx) => (
    <RoutineResult
      label={ctx.response ? 'Updated routine' : 'Update routine'}
      summary={ctx.response?.data.name}
      result={ctx.response?.data}
      renderContext={ctx.renderContext}
    />
  ),
});
