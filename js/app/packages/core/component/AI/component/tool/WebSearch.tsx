import { UnfurlLink } from '@core/component/Link';
import Globe from '@phosphor-icons/core/regular/globe.svg';
import { createSignal, For } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'WebSearch',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const results = () => {
      const content = ctx.response?.data.content;
      return Array.isArray(content) ? content : [];
    };
    const hitCount = () => results().length;
    const hasResults = () => hitCount() > 0;
    const statusText = () => {
      if (!ctx.response) return undefined;
      if (hitCount() === 0) return 'No Results';
      if (hitCount() === 1) return '1 result';
      return `${hitCount()} results`;
    };

    return (
      <BaseTool
        icon={Globe}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasResults() && isExpanded() ? (
            <div class="flex flex-col">
              <For each={results()}>
                {(result) => (
                  <UnfurlLink
                    unfurled={{
                      title: result.title,
                      url: result.url,
                    }}
                  />
                )}
              </For>
            </div>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <span>
              Searched for <span class="text-ink">{ctx.tool.data.input}</span>
            </span>
          </div>
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

export const webSearchHandler = handler;
