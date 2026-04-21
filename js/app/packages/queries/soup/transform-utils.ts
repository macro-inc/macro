import {
  blockNameToDefaultFile,
  itemToSafeName,
} from '@core/constant/allBlocks';
import { useChannelsContext } from '@core/context/channels';
import { emailToId } from '@core/user';
import {
  mergeAdjacentMacroEmTags,
  extractSearchSnippet,
  extractSearchTerms,
} from '@core/util/searchHighlight';
import type {
  SearchData,
  ContentHitData,
  WithSearch,
  EntityData,
  DocumentEntity,
  ChatEntity,
  ProjectEntity,
  EmailEntity,
  ChannelEntity,
  ChannelMessageEntity,
  CallEntity,
} from '@entity';
import type { ChannelType } from '@service-comms/generated/models';
import type {
  DocumentSearchResult,
  EmailSearchResult,
  ChatMessageSearchResult,
  ChannelSearchResult,
  ProjectSearchResult,
  UnifiedSearchResponseItem,
} from '@service-search/generated/models';
import type {
  SoupDocument,
  SoupPage,
} from '@service-storage/generated/schemas';
import type { UseQueryResult } from '@tanstack/solid-query';

type InnerSearchResult =
  | DocumentSearchResult
  | EmailSearchResult
  | ChatMessageSearchResult
  | ChannelSearchResult
  | ProjectSearchResult;

type TypedInnerSearchResult =
  | { results: InnerSearchResult[]; type?: undefined }
  | { results: DocumentSearchResult[]; type: 'pdf'; searchQuery: string }
  | { results: DocumentSearchResult[]; type: 'md' }
  | { results: ChannelSearchResult[]; type: 'channel' }
  | { results: EmailSearchResult[]; type: 'email'; searchQuery?: string };

const getSearchData = (data: TypedInnerSearchResult): SearchData => {
  let contentHitData: ContentHitData[] = [];

  switch (data.type) {
    case 'channel': {
      contentHitData = data.results.flatMap((r) => {
        const isContentHit = !!r.message_id;
        if (!isContentHit) return [];

        const contents = r.highlight.content ?? [];
        return contents.map((content) => ({
          type: 'channel' as const,
          id: r.message_id!,
          content: mergeAdjacentMacroEmTags(content),
          senderId: r.sender_id!,
          sentAt: r.created_at!,
          location: {
            type: 'channel' as const,
            threadId: r.thread_id ?? undefined,
            messageId: r.message_id!,
          },
        }));
      });
      break;
    }
    case 'pdf': {
      contentHitData = data.results.flatMap((r) => {
        const contents = r.highlight.content ?? [];
        return contents.map((content) => {
          const mergedContent = mergeAdjacentMacroEmTags(content);
          return {
            type: 'pdf' as const,
            content: mergeAdjacentMacroEmTags(content),
            location: {
              type: 'pdf' as const,
              searchPage: Number(r.node_id),
              searchSnippet: extractSearchSnippet(mergedContent),
              searchRawQuery: data.searchQuery,
              highlightTerms: extractSearchTerms(mergedContent),
            },
          };
        });
      });
      break;
    }
    case 'md': {
      contentHitData = data.results.flatMap((r) => {
        const isContentHit = !!r.node_id;
        if (!isContentHit) return [];

        const contents = r.highlight.content ?? [];
        return contents.map((content) => ({
          type: 'md' as const,
          content: mergeAdjacentMacroEmTags(content),
          location: { type: 'md' as const, nodeId: r.node_id! },
        }));
      });
      break;
    }
    case 'email': {
      contentHitData = data.results.flatMap((r) => {
        const contents = r.highlight.content ?? [];
        return contents.map((content) => ({
          type: 'email' as const,
          content: mergeAdjacentMacroEmTags(content),
          sender: r.pretty_sender!,
          senderId: emailToId(r.sender),
          sentAt: r.sent_at!,
          location: {
            type: 'email' as const,
            messageId: r.message_id!,
          },
        }));
      });
      break;
    }
    default: {
      contentHitData = data.results.flatMap((r) => {
        const contents = r.highlight.content ?? [];
        return contents.map((content) => ({
          content: mergeAdjacentMacroEmTags(content),
          location: undefined,
        }));
      });
    }
  }

  const nameHighlight = data.results.at(0)?.highlight.name ?? null;

  let senderHighlightTerms: string[] | null = null;
  if (data.type === 'email') {
    const hasSenderMatch = data.results.some((r) => r.highlight.sender);
    const terms = [
      ...new Set(
        data.results
          .flatMap((r) => extractSearchTerms(r.highlight.sender ?? ''))
          .map((t) => t.toLowerCase())
      ),
    ];
    if (hasSenderMatch && data.searchQuery) {
      const queryTerms = data.searchQuery
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      for (const t of queryTerms) {
        if (!terms.includes(t)) terms.push(t);
      }
    }
    senderHighlightTerms = terms.length > 0 ? terms : null;
  }

  return {
    nameHighlight: nameHighlight
      ? mergeAdjacentMacroEmTags(nameHighlight)
      : null,
    senderHighlightTerms,
    contentHitData: contentHitData.length > 0 ? contentHitData : null,
    source: 'service' as const,
  };
};

export const useSearchResponseItemMapper = () => {
  const channelsContext = useChannelsContext();
  const channels = channelsContext.channels;

  return (
    result: UnifiedSearchResponseItem,
    searchQuery: string
  ): (WithSearch<EntityData> | undefined)[] => {
    switch (result.type) {
      case 'document': {
        if (!result.metadata || result.metadata.deleted_at) return [];
        const searchFileType =
          result.file_type === 'docx' ? 'pdf' : result.file_type;
        let search: SearchData;
        if (searchFileType === 'md') {
          search = getSearchData({
            results: result.document_search_results,
            type: 'md',
          });
        } else if (searchFileType === 'pdf') {
          search = getSearchData({
            results: result.document_search_results,
            type: 'pdf',
            searchQuery,
          });
        } else {
          search = getSearchData({
            results: result.document_search_results,
          });
        }
        const properties = result.properties ?? undefined;
        return [
          {
            type: 'document',
            subType: result.sub_type === 'task' ? { type: 'task' } : null,
            id: result.document_id,
            name: result.name || blockNameToDefaultFile(result.file_type),
            ownerId: result.owner_id,
            createdAt: result.metadata?.created_at,
            updatedAt: result.metadata?.updated_at,
            fileType: result.file_type || undefined,
            projectId: result.metadata?.project_id ?? undefined,
            properties,
            search,
          },
        ];
      }
      case 'email': {
        const search = getSearchData({
          results: result.email_message_search_results,
          type: 'email',
          searchQuery,
        });

        const name = result.name ?? blockNameToDefaultFile('email');

        const participants = result.participants?.map((p) => ({
          email: p.email,
          name: p.name ?? undefined,
        }));

        return [
          {
            type: 'email',
            id: result.thread_id,
            name,
            ownerId: result.owner_id,
            createdAt: result.created_at,
            updatedAt: result.updated_at,
            viewedAt: result.viewed_at,
            isRead: result.is_read,
            isImportant: result.is_important,
            isDraft: result.is_draft,
            done: !result.inbox_visible,
            participants,
            search,
            snippet: result.snippet ?? undefined,
          },
        ];
      }
      case 'chat': {
        if (!result.metadata || result.metadata.deleted_at) return [];
        const search = getSearchData({
          results: result.chat_search_results,
        });
        return [
          {
            type: 'chat',
            id: result.chat_id,
            name: result.name,
            ownerId: result.user_id,
            createdAt: result.metadata?.created_at,
            updatedAt: result.metadata?.updated_at,
            projectId: result.metadata?.project_id ?? undefined,
            search,
          },
        ];
      }
      case 'channel': {
        const channelWithLatest = channels().find(
          (c) => c.id === result.channel_id
        );
        const channelName =
          channelWithLatest?.name ?? blockNameToDefaultFile('channel');
        const channelType = result.channel_type as ChannelType;
        const ownerId = result.owner_id ?? '';

        return result.channel_message_search_results
          .filter((msg) => !!msg.message_id)
          .map((msg): WithSearch<ChannelMessageEntity> => {
            const search = getSearchData({
              type: 'channel',
              results: [msg],
            });

            const content = search.contentHitData?.[0]?.content ?? '';

            return {
              type: 'channel_message',
              id: `${result.channel_id}:${msg.message_id}`,
              channelId: result.channel_id,
              channelName,
              channelType,
              messageId: msg.message_id!,
              threadId: msg.thread_id ?? undefined,
              senderId: msg.sender_id!,
              content,
              name: channelName,
              ownerId,
              createdAt: msg.created_at,
              updatedAt: msg.updated_at ?? msg.created_at,
              search,
            };
          });
      }

      case 'project': {
        if (!result.metadata || result.metadata.deleted_at) return [];
        const search = getSearchData({
          results: result.project_search_results,
        });

        return [
          {
            type: 'project',
            id: result.id,
            name: result.name,
            ownerId: result.owner_id,
            createdAt: result.created_at,
            updatedAt: result.updated_at,
            projectId: result.metadata?.parent_project_id ?? undefined,
            search,
          },
        ];
      }
    }
  };
};

const resolveDocumentEntityName = (
  entity: DocumentEntity | SoupDocument
): string => {
  return itemToSafeName({
    type: 'document',
    name: entity.name,
    fileType: entity.fileType,
    subType:
      entity.subType == null
        ? null
        : {
            type: entity.subType.type,
            is_completed: entity.subType.is_completed,
          },
  });
};

export const mapSoupPageToEntityList: (
  data: SoupPage,
  options: {
    instructionsIdQuery: UseQueryResult<string | null | undefined, Error>;
  }
) => (
  | DocumentEntity
  | ChatEntity
  | ProjectEntity
  | EmailEntity
  | ChannelEntity
  | CallEntity
)[] = (data, options) => {
  return data.items
    .filter(
      (item) =>
        item.tag !== 'document' ||
        !options.instructionsIdQuery.isSuccess ||
        item.data.id !== options.instructionsIdQuery.data
    )
    .map(
      (
        item
      ):
        | DocumentEntity
        | ChatEntity
        | ProjectEntity
        | EmailEntity
        | ChannelEntity
        | CallEntity => {
        if (item.tag === 'chat') {
          return {
            ...item.data,
            createdAt: item.data.createdAt,
            updatedAt: item.data.updatedAt,
            type: item.tag,
            name: item.data.name || 'New Chat',
            frecencyScore: item.frecency_score,
            viewedAt: item.data.viewedAt,
            projectId: item.data.projectId ?? undefined,
          };
        }

        if (item.tag === 'project') {
          return {
            createdAt: item.data.createdAt,
            updatedAt: item.data.updatedAt,
            id: item.data.id,
            ownerId: item.data.ownerId,
            frecencyScore: item.frecency_score,
            viewedAt: item.data.viewedAt,
            projectId: item.data.parentId ?? undefined,
            type: item.tag,
            name: item.data.name || 'New Project',
          };
        }

        if (item.tag === 'emailThread') {
          const participants = item.data.participants?.map((p) => ({
            email: p.emailAddress ?? '',
            name: p.name ?? '',
          }));

          const hasIcsAttachment = item.data.attachments?.some(
            (a) =>
              a.mimeType === 'text/calendar' ||
              a.filename?.toLowerCase().endsWith('.ics')
          );

          const attachments = item.data.attachments?.map((a) => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
          }));

          return {
            ...item.data,
            createdAt: item.data.createdAt,
            updatedAt: item.data.updatedAt,
            sortTs: item.data.sortTs,
            senderEmail: item.data.senderEmail ?? undefined,
            senderName: item.data.senderName ?? undefined,
            snippet: item.data.snippet ?? undefined,
            done: !item.data.inboxVisible,
            type: 'email',
            name: item.data.name || 'Email Thread',
            frecencyScore: item.frecency_score,
            viewedAt: item.data.viewedAt,
            projectId: item.data.projectId ?? undefined,
            participants,
            hasIcsAttachment,
            attachments,
          };
        }

        if (item.tag === 'callRecord') {
          return {
            type: 'call',
            id: item.data.callId,
            name: item.data.channelName ?? 'Call',
            channelId: item.data.channelId,
            channelName: item.data.channelName ?? undefined,
            ownerId: item.data.createdBy,
            createdAt: item.data.startedAt,
            updatedAt: item.data.endedAt ?? item.data.startedAt,
            sortTs: item.data.endedAt ?? item.data.startedAt,
            isActive: item.data.isActive,
            attended: item.data.attended,
            durationMs: item.data.durationMs ?? undefined,
            participantIds: item.data.participants.map((p) => p.userId),
          } satisfies CallEntity;
        }

        if (item.tag === 'channel') {
          const out: ChannelEntity = {
            type: 'channel',
            id: item.data.channel.id,
            name: item.data.channel.name || 'Unknown Channel',
            channelType: item.data.channel.channel_type,
            ownerId: item.data.channel.owner_id,
            frecencyScore: item.frecency_score ?? 0,
            updatedAt: item.data.channel.updated_at,
            createdAt: item.data.channel.created_at,
            participantIds: item.data.participants.map((p) => p.user_id),
            viewedAt: item.data.viewed_at ?? item.data.interacted_at,
            latestMessage: item.data.latest_non_thread_message
              ? {
                  content: item.data.latest_non_thread_message.content,
                  senderId: item.data.latest_non_thread_message.sender_id,
                  createdAt: item.data.latest_non_thread_message.created_at,
                }
              : undefined,
          };
          return out;
        }

        return {
          ...item.data,
          createdAt: item.data.createdAt,
          updatedAt: item.data.updatedAt,
          type: item.tag,
          frecencyScore: item.frecency_score,
          viewedAt: item.data.viewedAt,
          fileType: item.data.fileType ?? undefined,
          projectId: item.data.projectId ?? undefined,
          subType:
            item.data.subType === null || item.data.subType === undefined
              ? undefined
              : {
                  type: item.data.subType.type as 'task',
                  is_completed: item.data.subType.is_completed,
                },
          name: resolveDocumentEntityName(item.data),
        };
      }
    );
};
