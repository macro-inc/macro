import { EntityIcon } from '@core/component/EntityIcon';
import { TruncatedText } from '@core/component/FileList/TruncatedText';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import ChevronDown from '@icon/regular/caret-down.svg?component-solid';
import ChevronUp from '@icon/regular/caret-up.svg?component-solid';
import MagnifyingGlass from '@phosphor-icons/core/regular/magnifying-glass.svg';
import type { UnifiedSearchResult } from '@service-cognition/toolTypes';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { useSplitLayout } from 'app/component/split-layout/layout';
import { createMemo, createSignal, Show } from 'solid-js';
import { VList } from 'virtua/solid';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const UnifiedSearchToolResponse = (props: {
  results: UnifiedSearchResult[];
}) => {
  const [isExpanded, setIsExpanded] = createSignal(false);

  // results can have multiple content matches across the same entity
  const results = createMemo(() => {
    const seen = new Set<string>();
    return props.results.filter((result) => {
      let key: string;
      switch (result.type) {
        case 'document':
          key = result.document_id;
          break;
        case 'chat':
          key = result.chat_id;
          break;
        case 'email':
          key = result.thread_id;
          break;
        case 'channel':
          key = result.channel_id;
          break;
        case 'project':
          key = result.project_id;
          break;
        default:
          return false;
      }
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  const getResultTitle = (result: UnifiedSearchResult): string => {
    switch (result.type) {
      case 'document':
        return result.document_name || 'Document';
      case 'chat':
        return result.title || 'Chat';
      case 'email':
        return result.subject || 'Email';
      case 'channel':
        return 'Channel'; // there are no channel names from search results
      case 'project':
        return result.project_name || 'Project';
      default:
        return 'Result';
    }
  };

  const { replaceOrInsertSplit } = useSplitLayout();

  const getClickHandler = (result: UnifiedSearchResult) => {
    switch (result.type) {
      case 'document':
        return () => {
          const blockName = fileTypeToBlockName(result.file_type);
          replaceOrInsertSplit({ type: blockName, id: result.document_id });
        };
      case 'chat':
        return () => {
          replaceOrInsertSplit({ type: 'chat', id: result.chat_id });
        };
      case 'email':
        return () => {
          replaceOrInsertSplit({ type: 'email', id: result.thread_id });
        };
      case 'channel':
        return () => {
          replaceOrInsertSplit({ type: 'channel', id: result.channel_id });
        };
      case 'project':
        return () => {
          replaceOrInsertSplit({ type: 'project', id: result.project_id });
        };
      default:
        return undefined;
    }
  };

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
              Search Results ({results().length})
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
                    class="flex items-center w-full h-8 px-2 hover:bg-hover transition-colors"
                    onClick={clickHandler}
                  >
                    <div class="flex items-center flex-1 min-w-0 gap-2">
                      <EntityIcon
                        size="sm"
                        targetType={
                          result.type === 'document'
                            ? (result.file_type as FileType)
                            : result.type
                        }
                        shared={false}
                      />
                      <div class="flex-1 min-w-0">
                        <TruncatedText size="sm">
                          <span>{getResultTitle(result)}</span>
                        </TruncatedText>
                      </div>
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
  name: 'UnifiedSearch',
  renderCall: (ctx) => (
    <BaseTool
      icon={MagnifyingGlass}
      text="Searching..."
      renderContext={ctx.renderContext}
      type="call"
    />
  ),
  renderResponse: (ctx) => (
    <BaseTool
      icon={MagnifyingGlass}
      text="Found"
      renderContext={ctx.renderContext}
      type="response"
    >
      <UnifiedSearchToolResponse results={ctx.tool.data.response.results} />
    </BaseTool>
  ),
});

export const unifiedSearchHandler = handler;
