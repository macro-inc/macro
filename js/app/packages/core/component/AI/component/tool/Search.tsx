import { getEntityClickContent } from '@channel/Attachments/attachment-utils';
import {
  type EntityData,
  EntityRowIcon,
  EntityRowTitle,
  SearchContent,
  SearchSender,
  SearchTimestamp,
  type WithSearch,
} from '@entity';
import MagnifyingGlass from '@phosphor-icons/core/regular/magnifying-glass.svg';
import { useSearchResponseItemMapper } from '@queries/soup/transform-utils';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { useSplitLayout } from 'app/component/split-layout/layout';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer, type ToolRenderContext } from './ToolRenderer';

type UnifiedSearchResult = NamedTool<
  'NameSearch',
  'response'
>['data']['results'][number];
type SearchEntity = WithSearch<EntityData>;

const getToolSearchQuery = (
  ctx: ToolRenderContext<'ContentSearch' | 'NameSearch'>
) => {
  return 'query' in ctx.tool.data ? ctx.tool.data.query : ctx.tool.data.name;
};

function SearchResultRow(props: { entity: SearchEntity; onClick: () => void }) {
  const hit = () => props.entity.search.contentHitData?.[0];

  return (
    <button
      type="button"
      class="block w-full text-left hover:bg-surface-hover"
      onClick={props.onClick}
    >
      <Tool.ListItem icon={<EntityRowIcon entity={props.entity} />}>
        <div class="flex min-w-0 items-center gap-2">
          <div class="min-w-0 flex flex-1 items-center gap-1.5">
            <span class="min-w-0 max-w-40 shrink-0 truncate text-ink">
              <EntityRowTitle entity={props.entity} />
            </span>
            <span class="text-ink-placeholder">·</span>
            <Show when={hit()}>
              {(contentHit) => (
                <>
                  <span class="shrink-0 text-ink-placeholder">
                    <SearchSender hit={contentHit()} />
                  </span>
                  <span class="min-w-0 flex-1 truncate text-ink-placeholder">
                    <SearchContent hit={contentHit()} singleLine />
                  </span>
                </>
              )}
            </Show>
          </div>
          <span class="shrink-0 text-ink-placeholder">
            <SearchTimestamp hit={hit()} />
          </span>
        </div>
      </Tool.ListItem>
    </button>
  );
}

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
    <div class="max-h-120 overflow-y-auto">
      <Tool.List>
        <For each={entities()}>
          {(entity) => {
            if (!entity) return null;
            return (
              <SearchResultRow
                entity={entity}
                onClick={() =>
                  replaceOrInsertSplit(getEntityClickContent(entity))
                }
              />
            );
          }}
        </For>
      </Tool.List>
    </div>
  );
};

function SearchText(props: { query: string }) {
  return (
    <span class="min-w-0 truncate">
      Search <span class="text-ink"> {props.query} </span>
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
          <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
            <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <SearchText query={query()} />
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

export const nameSearchHandler = createHandler('NameSearch');
export const contentSearchHandler = createHandler('ContentSearch');
