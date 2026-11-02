import Brain from '@phosphor-icons/core/regular/brain.svg';
import { createSignal } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer, type RenderContext } from './ToolRenderer';

function MemoryResult(props: {
  label: string;
  text: string | undefined;
  status: string;
  emptyText?: string;
  renderContext: RenderContext['renderContext'];
}) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <BaseTool
      icon={Brain}
      renderContext={props.renderContext}
      type="call"
      response={
        expanded() && props.text !== undefined ? (
          <pre class="whitespace-pre-wrap break-words p-3 font-sans text-sm text-ink">
            {props.text || props.emptyText || 'No saved memory.'}
          </pre>
        ) : undefined
      }
    >
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span>{props.label}</span>
        <Tool.ResultToggle
          expanded={expanded()}
          onToggle={() => setExpanded((value) => !value)}
          showToggle={props.text !== undefined}
          status={props.status}
        />
      </div>
    </BaseTool>
  );
}

export const readMemoryHandler = createToolRenderer({
  name: 'ReadMemory',
  render: (ctx) => (
    <MemoryResult
      label="Read memory"
      text={ctx.response?.data.content}
      status={ctx.response ? 'Private' : ''}
      renderContext={ctx.renderContext}
    />
  ),
});

export const updateMemoryHandler = createToolRenderer({
  name: 'UpdateMemory',
  render: (ctx) => (
    <MemoryResult
      label="Update memory"
      text={ctx.response?.data.content}
      status={ctx.response ? 'Saved' : ''}
      renderContext={ctx.renderContext}
    />
  ),
});

export const getUserActivityHandler = createToolRenderer({
  name: 'GetUserActivity',
  render: (ctx) => (
    <MemoryResult
      label="Read activity"
      emptyText="No activity for these dates."
      text={ctx.response?.data.reports
        .map(
          (report) =>
            `${report.granularity}: ${report.periodStart} – ${report.periodEnd}\n${report.content}`
        )
        .join('\n\n')}
      status={
        ctx.response
          ? `${ctx.response.data.reports.length} ${ctx.response.data.reports.length === 1 ? 'report' : 'reports'}`
          : ''
      }
      renderContext={ctx.renderContext}
    />
  ),
});
