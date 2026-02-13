import {
  blockNameToDefaultFile,
  itemToSafeName,
} from '@core/constant/allBlocks';
import { useChannelsContext } from '@core/context/channels';
import { emailToId } from '@core/user';
import {
  truncateSearchMatch,
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
} from '@entity';
import { useHistoryQuery } from '@queries/history/history';
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
import { max } from 'date-fns';

const SEARCH_MATCH_LENGTH = 60;

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
  | { results: EmailSearchResult[]; type: 'email' };

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
          content: truncateSearchMatch(
            mergeAdjacentMacroEmTags(content),
            SEARCH_MATCH_LENGTH
          ),
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
            content: truncateSearchMatch(
              mergeAdjacentMacroEmTags(content),
              SEARCH_MATCH_LENGTH
            ),
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
          content: truncateSearchMatch(
            mergeAdjacentMacroEmTags(content),
            SEARCH_MATCH_LENGTH
          ),
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
          content: truncateSearchMatch(
            mergeAdjacentMacroEmTags(content),
            SEARCH_MATCH_LENGTH
          ),
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
          content: truncateSearchMatch(
            mergeAdjacentMacroEmTags(content),
            SEARCH_MATCH_LENGTH
          ),
          location: undefined,
        }));
      });
    }
  }

  const nameHighlight = data.results.at(0)?.highlight.name ?? null;

  return {
    nameHighlight: nameHighlight
      ? mergeAdjacentMacroEmTags(nameHighlight)
      : null,
    contentHitData: contentHitData.length > 0 ? contentHitData : null,
    source: 'service' as const,
  };
};

export const useSearchResponseItemMapper = () => {
  const channelsContext = useChannelsContext();
  const channels = channelsContext.channels;

  const historyQuery = useHistoryQuery();

  return (
    result: UnifiedSearchResponseItem,
    searchQuery: string
  ): WithSearch<EntityData> | undefined => {
    switch (result.type) {
      case 'document': {
        if (!result.metadata || result.metadata.deleted_at) return;
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
        return {
          type: 'document',
          subType: result.sub_type === 'task' ? { type: 'task' } : null,
          id: result.document_id,
          name: result.name || blockNameToDefaultFile(result.file_type),
          ownerId: result.owner_id,
          createdAt: result.metadata?.created_at,
          updatedAt: result.metadata?.updated_at,
          fileType: result.file_type || undefined,
          projectId: result.metadata?.project_id ?? undefined,
          search,
        };
      }
      case 'email': {
        const messageHits = result.email_message_search_results.filter(
          (m) => m.message_id
        );
        // NOTE: guaranteed to be empty or singleton array
        const threadHits = result.email_message_search_results.filter(
          (m) => !m.message_id
        );

        const singleMessage = messageHits.length === 1;

        const search = getSearchData({
          results: result.email_message_search_results,
          type: 'email',
        });

        const name = result.name ?? blockNameToDefaultFile('email');

        // TODO: display sender for each message in the content hit list
        const combinedSenders =
          [...new Set(messageHits.map((m) => m.pretty_sender))].join(', ') ||
          threadHits.at(0)?.pretty_sender;

        // TODO: we probably want to get the actual latest message info on the full thread
        const messagesSentAt = messageHits
          .map((m) => m.sent_at)
          .filter((m) => m != null);
        const latestMessageSentAt =
          messagesSentAt.length > 0 ? max(messagesSentAt) : null;

        return {
          type: 'email',
          id: result.thread_id,
          name,
          ownerId: result.owner_id,
          createdAt: latestMessageSentAt ?? result.created_at,
          updatedAt: latestMessageSentAt ?? result.updated_at,
          viewedAt: result.viewed_at,
          isRead: singleMessage
            ? !messageHits[0].labels.includes('UNREAD')
            : false,
          isImportant: singleMessage
            ? messageHits[0].labels.includes('IMPORTANT')
            : false,
          isDraft: singleMessage
            ? messageHits[0].labels.includes('DRAFT')
            : false,
          done: singleMessage
            ? !messageHits[0].labels.includes('INBOX')
            : false,
          senderName: combinedSenders,
          search,
        };
      }
      case 'chat': {
        if (!result.metadata || result.metadata.deleted_at) return;
        const search = getSearchData({
          results: result.chat_search_results,
        });
        let name = result.name;
        if (!name || name === blockNameToDefaultFile('chat')) {
          const chat = (historyQuery.data ?? []).find(
            (item) => item.id === result.chat_id
          );
          if (chat) {
            name = chat.name;
          }
        }
        return {
          type: 'chat',
          id: result.chat_id,
          name,
          ownerId: result.user_id,
          createdAt: result.metadata?.created_at,
          updatedAt: result.metadata?.updated_at,
          projectId: result.metadata?.project_id ?? undefined,
          search,
        };
      }
      case 'channel': {
        const channelWithLatest = channels().find(
          (c) => c.id === result.channel_id
        );

        const search = getSearchData({
          type: 'channel',
          results: result.channel_message_search_results,
        });

        return {
          type: 'channel',
          id: result.channel_id,
          name: channelWithLatest?.name ?? blockNameToDefaultFile('channel'),
          ownerId: result.owner_id ?? '',
          createdAt: result.metadata?.created_at,
          updatedAt: result.metadata?.updated_at,
          channelType: result.channel_type as ChannelType,
          interactedAt: result.metadata?.interacted_at,
          participantIds: channelWithLatest?.participants?.map(
            (p) => p.user_id
          ),
          search,
        };
      }

      case 'project': {
        if (!result.metadata || result.metadata.deleted_at) return;
        const search = getSearchData({
          results: result.project_search_results,
        });

        return {
          type: 'project',
          id: result.id,
          name: result.name,
          ownerId: result.owner_id,
          createdAt: result.created_at,
          updatedAt: result.updated_at,
          projectId: result.metadata?.parent_project_id ?? undefined,
          search,
        };
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
      entity.subType === null || entity.subType === undefined
        ? null
        : {
            type: entity.subType.type as 'task',
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
        | ChannelEntity => {
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

          return {
            ...item.data,
            createdAt: item.data.createdAt,
            updatedAt: item.data.updatedAt,
            senderEmail: item.data.senderEmail ?? undefined,
            senderName: item.data.senderName ?? undefined,
            snippet: item.data.snippet ?? undefined,
            done: !item.data.inboxVisible,
            type: 'email',
            name: item.data.name || 'Email Thread',
            frecencyScore: item.frecency_score,
            viewedAt: item.data.viewedAt,
            participants,
          };
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
