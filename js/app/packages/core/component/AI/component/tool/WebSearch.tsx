import { UnfurlLink } from '@core/component/Link';
import CaretRight from '@icon/regular/caret-right.svg?component-solid';
import Globe from '@phosphor-icons/core/regular/globe.svg';
import { createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'web_search',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const results = () => ctx.response?.data.content ?? [];
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
              Searched for{' '}
              <span class="text-accent">{ctx.tool.data.query}</span>
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Show when={statusText()}>
              {(text) => (
                <span class="text-xs text-ink-extra-muted">{text()}</span>
              )}
            </Show>
            <Show when={hasResults()}>
              <button
                type="button"
                class="shrink-0 text-ink-muted hover:text-ink p-1"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setIsExpanded((expanded) => !expanded);
                }}
              >
                <CaretRight
                  class="h-4 w-4 transition-transform"
                  classList={{
                    'rotate-90': isExpanded(),
                  }}
                />
              </button>
            </Show>
          </div>
        </div>
      </BaseTool>
    );
  },
});

export const webSearchHandler = handler;
