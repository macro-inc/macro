import { EntityIcon } from '@core/component/EntityIcon';
import { TruncatedText } from '@core/component/FileList/TruncatedText';
import ChevronDown from '@icon/regular/caret-down.svg?component-solid';
import ChevronUp from '@icon/regular/caret-up.svg?component-solid';
import List from '@phosphor-icons/core/regular/list.svg';
import type { ListEmailsResult } from '@service-cognition/toolTypes';
import { useSplitLayout } from 'app/component/split-layout/layout';
import { createMemo, createSignal, Show } from 'solid-js';
import { VList } from 'virtua/solid';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const ListEmailsToolResponse = (props: { results: ListEmailsResult[] }) => {
  const [isExpanded, setIsExpanded] = createSignal(false);

  const results = createMemo(() => {
    // results should be unique but this is an extra safety check
    const seen = new Set<string>();
    return props.results.filter((result) => {
      let key = result.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  const getResultTitle = (result: ListEmailsResult): string => {
    return result.name || result.snippet || 'Email';
  };

  const { replaceOrInsertSplit } = useSplitLayout();

  const getClickHandler = (result: ListEmailsResult) => {
    return () => {
      replaceOrInsertSplit({ type: 'email', id: result.id });
    };
  };

  // TODO: share code with unified search results display
  return (
    <Show when={results().length > 0}>
      <div class="border border-edge rounded w-full">
        <button
          class={`flex items-center justify-between w-full text-left p-2 hover:bg-hover transition-colors ${
            isExpanded() ? 'rounded-t border-b border-edge' : 'rounded'
          }`}
          onClick={() => setIsExpanded((e) => !e)}
        >
          <div class="flex items-center gap-2">
            <div class="text-sm font-medium text-ink">
              Email Results ({results().length})
            </div>
          </div>
          <div class="flex items-center gap-1 text-ink-muted">
            <Show
              when={isExpanded()}
              fallback={<ChevronDown class="w-4 h-4" />}
            >
              <ChevronUp class="w-4 h-4" />
            </Show>
          </div>
        </button>

        <Show when={isExpanded()}>
          <div class="max-h-[480px] overflow-hidden">
            <VList
              data={results()}
              overscan={5}
              itemSize={32}
              style={{
                height: `${Math.min(results().length * 32, 480)}px`,
                contain: 'content',
              }}
            >
              {(result) => {
                const clickHandler = getClickHandler(result);

                return (
                  <div
                    class="flex items-center w-full h-8 px-2 hover:bg-hover transition-colors cursor-pointer"
                    onClick={clickHandler}
                  >
                    <div class="flex items-center flex-1 min-w-0 gap-2">
                      <EntityIcon size="sm" targetType="email" shared={false} />
                      <div class="flex-1 min-w-0">
                        <TruncatedText size="sm">
                          <span>{getResultTitle(result)}</span>
                        </TruncatedText>
                      </div>
                      <Show when={result.senderName}>
                        <div class="text-xs text-ink-muted shrink-0">
                          {result.senderName}
                        </div>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </VList>
          </div>
        </Show>
      </div>
    </Show>
  );
};

const handler = createToolRenderer({
  name: 'ListEmails',
  renderCall: (ctx) => (
    <BaseTool
      icon={List}
      text="Listing emails..."
      renderContext={ctx.renderContext}
      type="call"
    />
  ),
  renderResponse: (ctx) => (
    <BaseTool
      icon={List}
      text="Listed emails"
      renderContext={ctx.renderContext}
      type="response"
    >
      <ListEmailsToolResponse results={ctx.tool.data.previews?.items || []} />
    </BaseTool>
  ),
});

export const listEmailsHandler = handler;
