import { fileTypeToBlockName } from '@core/constant/allBlocks';
import CaretRight from '@icon/regular/caret-right.svg?component-solid';
import MagnifyingGlass from '@phosphor-icons/core/regular/magnifying-glass.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { useSplitLayout } from 'app/component/split-layout/layout';
import { useChannelsContext } from '@core/context/channels';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer, type ToolRenderContext } from './ToolRenderer';
import { ListEntity } from '@entity';
import type { WithNotification } from '@entity/types/notification';
import type {
  EntityData,
  ChatEntity,
  ChannelEntity,
  EmailEntity,
  ProjectEntity,
  DocumentEntity,
} from '@entity/types/entity';
import type { ContentHitData, SearchData } from '@entity/types/search';

type UnifiedSearchResult = NamedTool<
  'NameSearch',
  'response'
>['data']['results'][number];

type EntityWithSearch = EntityData & { search: SearchData };

function searchResultsToEntities(
  results: UnifiedSearchResult[],
  channelsById: Record<string, { name?: string | null }>
): EntityWithSearch[] {
  const entityMap = new Map<
    string,
    {
      entity: EntityData;
      contentHits: ContentHitData[];
      nameHighlight: string | null;
    }
  >();

  for (const result of results) {
    let key: string;
    let entity: EntityData;
    let contentHits: ContentHitData[] = [];
    let nameHighlight: string | null = null;

    switch (result.type) {
      case 'document': {
        key = result.document_id;
        entity = {
          id: result.document_id,
          type: 'document',
          name: result.document_name || 'Document',
          ownerId: result.owner_id,
          fileType: result.file_type ?? undefined,
          projectId: result.metadata?.project_id ?? undefined,
          createdAt: result.metadata?.created_at ?? null,
          updatedAt: result.metadata?.updated_at ?? null,
          subType: result.sub_type === 'task' ? { type: 'task' } : undefined,
        } as DocumentEntity;

        for (const sr of result.document_search_results) {
          if (sr.highlight.name) nameHighlight = sr.highlight.name;
          if (sr.highlight.content?.length) {
            for (const content of sr.highlight.content) {
              if (result.file_type === 'md' && sr.node_id) {
                contentHits.push({
                  type: 'md',
                  content,
                  location: { type: 'md', nodeId: sr.node_id },
                });
              } else if (result.file_type === 'pdf') {
                contentHits.push({ content });
              } else {
                contentHits.push({ content });
              }
            }
          }
        }
        break;
      }
      case 'chat': {
        key = result.chat_id;
        entity = {
          id: result.chat_id,
          type: 'chat',
          name: result.name || 'Chat',
          ownerId: result.owner_id,
          projectId: result.metadata?.project_id ?? undefined,
          createdAt: result.metadata?.created_at ?? null,
          updatedAt: result.metadata?.updated_at ?? null,
        } satisfies ChatEntity;

        for (const sr of result.chat_search_results) {
          if (sr.highlight.name) nameHighlight = sr.highlight.name;
          if (sr.highlight.content?.length) {
            for (const content of sr.highlight.content) {
              contentHits.push({ content });
            }
          }
        }
        break;
      }
      case 'email': {
        key = result.thread_id;
        entity = {
          id: result.thread_id,
          type: 'email',
          name: result.subject || result.name || 'Email',
          ownerId: result.owner_id,
          isRead: result.is_read,
          isDraft: result.is_draft,
          isImportant: result.is_important,
          done: false,
          snippet: result.snippet ?? undefined,
          participants: result.participants.map((p) => ({
            email: p.email,
            name: p.name ?? undefined,
          })),
          senderEmail: result.email_message_search_results[0]?.sender,
          senderName: result.email_message_search_results[0]?.pretty_sender,
          updatedAt: result.updated_at,
          createdAt: result.created_at,
        } satisfies EmailEntity;

        for (const sr of result.email_message_search_results) {
          if (sr.highlight.name) nameHighlight = sr.highlight.name;
          if (sr.highlight.content?.length) {
            for (const content of sr.highlight.content) {
              contentHits.push({
                type: 'email',
                content,
                sender: sr.pretty_sender,
                senderId: sr.sender,
                sentAt: sr.sent_at ?? result.created_at,
                location: {
                  type: 'email',
                  messageId: sr.message_id ?? '',
                },
              });
            }
          }
        }
        break;
      }
      case 'channel': {
        key = result.channel_id;
        entity = {
          id: result.channel_id,
          type: 'channel',
          name: channelsById[result.channel_id]?.name ?? 'Channel',
          ownerId: result.owner_id ?? '',
          channelType:
            (result.channel_type as ChannelEntity['channelType']) ?? 'public',
          createdAt: result.metadata?.created_at ?? null,
          updatedAt: result.metadata?.updated_at ?? null,
        } satisfies ChannelEntity;

        for (const sr of result.channel_message_search_results) {
          if (sr.highlight.content?.length) {
            for (const content of sr.highlight.content) {
              contentHits.push({
                type: 'channel',
                id: sr.message_id ?? '',
                content,
                senderId: sr.sender_id ?? '',
                sentAt: sr.created_at ?? '',
                location: {
                  type: 'channel',
                  threadId: sr.thread_id ?? undefined,
                  messageId: sr.message_id ?? '',
                },
              });
            }
          }
        }
        break;
      }
      case 'project': {
        key = result.id;
        entity = {
          id: result.id,
          type: 'project',
          name: result.name || 'Project',
          ownerId: result.owner_id,
          createdAt: result.metadata?.created_at ?? null,
          updatedAt: result.metadata?.updated_at ?? null,
        } satisfies ProjectEntity;

        for (const sr of result.project_search_results) {
          if (sr.highlight.name) nameHighlight = sr.highlight.name;
          if (sr.highlight.content?.length) {
            for (const content of sr.highlight.content) {
              contentHits.push({ content });
            }
          }
        }
        break;
      }
      default:
        continue;
    }

    const existing = entityMap.get(key);
    if (existing) {
      existing.contentHits.push(...contentHits);
      if (nameHighlight) existing.nameHighlight = nameHighlight;
    } else {
      entityMap.set(key, { entity, contentHits, nameHighlight });
    }
  }

  return Array.from(entityMap.values()).map(
    ({ entity, contentHits, nameHighlight }) => ({
      ...entity,
      search: {
        nameHighlight,
        senderHighlightTerms: null,
        contentHitData: contentHits.length > 0 ? contentHits : null,
        source: 'service' as const,
      },
    })
  );
}

const UnifiedSearchToolResponse = (props: {
  results: UnifiedSearchResult[];
}) => {
  const channelsCtx = useChannelsContext();
  const entities = createMemo(() =>
    searchResultsToEntities(props.results, channelsCtx.channelsById())
  );

  const { replaceOrInsertSplit } = useSplitLayout();

  const getClickHandler = (entity: EntityData) => {
    switch (entity.type) {
      case 'document': {
        const blockName = fileTypeToBlockName(
          (entity as DocumentEntity).fileType
        );
        return () => replaceOrInsertSplit({ type: blockName, id: entity.id });
      }
      case 'chat':
        return () => replaceOrInsertSplit({ type: 'chat', id: entity.id });
      case 'email':
        return () => replaceOrInsertSplit({ type: 'email', id: entity.id });
      case 'channel':
        return () => replaceOrInsertSplit({ type: 'channel', id: entity.id });
      case 'project':
        return () => replaceOrInsertSplit({ type: 'project', id: entity.id });
      default:
        return undefined;
    }
  };

  return (
    <div class="max-h-[480px] overflow-y-auto">
      <For each={entities()}>
        {(entity) => {
          const clickHandler = getClickHandler(entity);
          return (
            <ListEntity
              entity={entity as WithNotification<EntityData>}
              onClick={clickHandler}
            />
          );
        }}
      </For>
    </div>
  );
};

function SearchText(props: {
  ctx: ToolRenderContext<'ContentSearch' | 'NameSearch'>;
}) {
  const ctx = props.ctx;
  const queryString =
    'query' in ctx.tool.data ? ctx.tool.data.query : ctx.tool.data.name;

  return (
    <span>
      Search <span class="text-accent"> {queryString} </span>
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
              <UnifiedSearchToolResponse results={results()} />
            ) : undefined
          }
        >
          <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <SearchText ctx={ctx} />
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
