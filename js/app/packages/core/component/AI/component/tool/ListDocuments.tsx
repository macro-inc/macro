import { EntityIcon } from '@core/component/EntityIcon';
import { TruncatedText } from '@core/component/FileList/TruncatedText';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import ChevronDown from '@icon/regular/caret-down.svg?component-solid';
import ChevronUp from '@icon/regular/caret-up.svg?component-solid';
import List from '@phosphor-icons/core/regular/list.svg';
import type { ListDocumentsResult } from '@service-cognition/toolTypes';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { useSplitLayout } from 'app/component/split-layout/layout';
import { createMemo, createSignal, Show } from 'solid-js';
import { VList } from 'virtua/solid';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const ListDocumentsToolResponse = (props: {
  results: ListDocumentsResult[];
}) => {
  const [isExpanded, setIsExpanded] = createSignal(false);

  const results = createMemo(() => {
    // results should be unique but this is an extra safety check
    const seen = new Set<string>();
    return props.results.filter((result) => {
      let key = result.document_id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  const getResultTitle = (result: ListDocumentsResult): string => {
    return result.document_name || 'Document';
  };

  const { replaceOrInsertSplit } = useSplitLayout();

  const getClickHandler = (result: ListDocumentsResult) => {
    return () => {
      const blockName = fileTypeToBlockName(result.file_type);
      replaceOrInsertSplit({ type: blockName, id: result.document_id });
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
                        targetType={result.file_type as FileType | undefined}
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
  name: 'ListDocuments',
  renderCall: (ctx) => (
    <BaseTool
      icon={List}
      text="Listing documents..."
      renderContext={ctx.renderContext}
      type="call"
    />
  ),
  renderResponse: (ctx) => (
    <BaseTool
      icon={List}
      text="Listed"
      renderContext={ctx.renderContext}
      type="response"
    >
      <ListDocumentsToolResponse results={ctx.tool.data.results} />
    </BaseTool>
  ),
});

export const listDocumentsHandler = handler;
