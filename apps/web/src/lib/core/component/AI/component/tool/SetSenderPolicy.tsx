import Funnel from '@phosphor-icons/core/regular/funnel.svg';
import type { ToolSenderPolicy } from '@service-cognition/generated/tools/types';
import { createSignal } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

const POLICY_LABEL: Record<ToolSenderPolicy, string> = {
  signal: 'Sender → Signal',
  noise: 'Sender → Noise',
  block: 'Block Sender',
};

const POLICY_STATUS: Record<ToolSenderPolicy, string> = {
  signal: 'Signal',
  noise: 'Noise',
  block: 'Block',
};

const handler = createToolRenderer({
  name: 'SetSenderPolicy',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const summary = () => ctx.response?.data.summary;
    const hasResults = () => Boolean(summary());
    const statusText = () => {
      if (!ctx.response) return undefined;
      return POLICY_STATUS[ctx.response.data.policy];
    };

    return (
      <BaseTool
        icon={Funnel}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasResults() && isExpanded() ? (
            <p class="text-xs text-ink">{summary()}</p>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <span class="min-w-0 truncate">
            {POLICY_LABEL[ctx.tool.data.policy]}
          </span>
          <Tool.ResultToggle
            expanded={isExpanded()}
            onToggle={() => setIsExpanded((expanded) => !expanded)}
            showToggle={hasResults()}
            status={statusText()}
          />
        </div>
      </BaseTool>
    );
  },
});

export const setSenderPolicyHandler = handler;
