import CaretRight from '@icon/regular/caret-right.svg?component-solid';
import MagnifyingGlass from '@phosphor-icons/core/regular/magnifying-glass.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { useSplitLayout } from 'app/component/split-layout/layout';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer, type ToolRenderContext } from './ToolRenderer';
import { ListEntity } from '@entity';
import { useSearchResponseItemMapper } from '@queries/soup/transform-utils';
import { getEntityClickContent } from '@channel/Attachments/attachment-utils';

type UnifiedSearchResult = NamedTool<
  'NameSearch',
  'response'
>['data']['results'][number];

const getToolSearchQuery = (
  ctx: ToolRenderContext<'ContentSearch' | 'NameSearch'>
) => {
  return 'query' in ctx.tool.data ? ctx.tool.data.query : ctx.tool.data.name;
};

const UnifiedSearchToolResponse = (props: {
  results: UnifiedSearchResult[];
  query: string;
}) => {
  const mapResponseItem = useSearchResponseItemMapper();
  const { replaceOrInsertSplit } = useSplitLayout();

  const entities = createMemo(() =>
    props.results.flatMap(
      (result) => mapResponseItem(result, props.query) ?? []
    )
  );

  return (
    <div class="max-h-[480px] overflow-y-auto">
      <For each={entities()}>
        {(entity) => {
          if (!entity) return null;
          return (
            <ListEntity
              entity={entity}
              onClick={() =>
                replaceOrInsertSplit(getEntityClickContent(entity))
              }
            />
          );
        }}
      </For>
    </div>
  );
};

function SearchText(props: { query: string }) {
  return (
    <span>
      Search <span class="text-accent"> {props.query} </span>
    </span>
  );
}

const createHandler = (name: 'NameSearch' | 'ContentSearch') =>
  createToolRenderer({
    name,
    render: (ctx) => {
      const [isExpanded, setIsExpanded] = createSignal(false);
      const results = () => ctx.response?.data.results ?? [];
      const hitCount = () => results().length;
      const hasResults = () => hitCount() > 0;
      const query = () => getToolSearchQuery(ctx);
      const statusText = () => {
        if (!ctx.response) return undefined;
        if (hitCount() === 0) return 'No Results';
        if (hitCount() === 1) return '1 hit';
        return `${hitCount()} hits`;
      };

      return (
        <BaseTool
          icon={MagnifyingGlass}
          renderContext={ctx.renderContext}
          type="call"
          response={
            hasResults() && isExpanded() ? (
              <UnifiedSearchToolResponse results={results()} query={query()} />
            ) : undefined
          }
        >
          <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <SearchText query={query()} />
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

export const nameSearchHandler = createHandler('NameSearch');
export const contentSearchHandler = createHandler('ContentSearch');
