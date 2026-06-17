import {
  blockNameToDefaultFile,
  itemToSafeName,
} from '@core/constant/allBlocks';
import { useChannelsContext } from '@core/context/channels';
import { emailToId } from '@core/user';
import {
  extractSearchSnippet,
  extractSearchTerms,
  mergeAdjacentMacroEmTags,
} from '@core/util/searchHighlight';
import type {
  CallEntity,
  ChannelEntity,
  ChannelMessageEntity,
  ChatEntity,
  ContentHitData,
  CrmCompanyEntity,
  DocumentEntity,
  EmailEntity,
  EntityData,
  ForeignEntity,
  GithubPullRequestEntity,
  NamedSubType,
  ProjectEntity,
  SearchData,
  WithSearch,
} from '@entity';
import type {
  CallRecordSearchResult,
  ChannelSearchResult,
  ChatMessageSearchResult,
  DocumentSearchResult,
  EmailSearchResult,
  ProjectSearchResult,
  UnifiedSearchResponseItem,
} from '@service-search/generated/models';
import type {
  GithubPullRequest,
  SoupApiItem,
  SoupDocument,
  SoupPage,
} from '@service-storage/generated/schemas';
import type { ChannelType } from '@service-storage/generated/schemas/channelType';
import type { UseQueryResult } from '@tanstack/solid-query';
import { differenceInMilliseconds } from 'date-fns';
import { match } from 'ts-pattern';

type InnerSearchResult =
  | DocumentSearchResult
  | EmailSearchResult
  | ChatMessageSearchResult
  | ChannelSearchResult
  | ProjectSearchResult
  | CallRecordSearchResult;

// Channel thread soup items are currently only exposed to AI tooling; the app
// entity list does not have enough channel metadata to render them directly.
type DisplayableSoupItem = Exclude<
  SoupPage['items'][number],
  { tag: 'channelThread' }
>;

type SoupEntity =
  | DocumentEntity
  | ChatEntity
  | ProjectEntity
  | EmailEntity
  | ChannelEntity
  | CallEntity
  | CrmCompanyEntity
  | ForeignEntity;

type TypedInnerSearchResult =
  | { results: InnerSearchResult[]; type?: undefined }
  | { results: DocumentSearchResult[]; type: 'pdf'; searchQuery: string }
  | { results: DocumentSearchResult[]; type: 'md' }
  | { results: ChannelSearchResult[]; type: 'channel' }
  | { results: EmailSearchResult[]; type: 'email'; searchQuery?: string }
  | {
      results: CallRecordSearchResult[];
      type: 'call_record';
      callId: string;
      callStartedAt: string;
    };

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
    case 'call_record': {
      contentHitData = data.results.flatMap((r) => {
        // TODO: support name only hits for call records when we support rename
        const isContentHit = !!r.transcript_id;
        if (!isContentHit) return [];

        const videoSeconds = Math.max(
          0,
          differenceInMilliseconds(r.started_at!, data.callStartedAt) / 1000
        );

        const contents = r.highlight.content ?? [];
        return contents.map((content) => ({
          type: 'call_record' as const,
          id: r.transcript_id!,
          content: mergeAdjacentMacroEmTags(content),
          senderId: r.speaker_id!,
          sentAt: r.started_at!,
          videoSeconds,
          location: {
            type: 'call_record' as const,
            callId: data.callId,
            transcriptId: r.transcript_id!,
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

  const nameHighlight =
    data.results.find((r) => r.highlight.name)?.highlight.name ?? null;

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

/**
 * Maps a single channel search response item into `ChannelMessageEntity`s.
 * Shared between the unified search transform and the channel-only endpoint,
 * both of which return the same per-channel shape.
 */
export function mapChannelSearchResultItem(
  result: {
    channel_id: string;
    channel_type: string;
    owner_id?: string | null;
    channel_message_search_results: ChannelSearchResult[];
  },
  channels: ReadonlyArray<{ id: string; name?: string | null }>
): WithSearch<ChannelMessageEntity>[] {
  const channelWithLatest = channels.find((c) => c.id === result.channel_id);
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

export const useSearchResponseItemMapper = () => {
  const channelsContext = useChannelsContext();
  const channels = channelsContext.channels;

  return (
    result: UnifiedSearchResponseItem,
    searchQuery: string
  ): (WithSearch<EntityData> | undefined)[] => {
    switch (result.type) {
      case 'company': {
        const primaryDomain = result.domains[0]?.domain;
        const nameHighlight = result.nameHighlighted
          ? mergeAdjacentMacroEmTags(result.nameHighlighted)
          : null;
        return [
          {
            type: 'crm_company',
            id: result.id,
            teamId: result.teamId,
            name: result.name || primaryDomain || 'Unknown Company',
            ownerId: result.teamId,
            description: result.description ?? undefined,
            // Not returned by search — left undefined ("not loaded") so
            // consumers don't mistake it for a real `false`.
            emailSync: undefined,
            hidden: result.hidden,
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
            sortTs: result.updatedAt,
            domains: result.domains.map((d) => ({
              id: d.id,
              companyId: d.companyId,
              domain: d.domain,
              createdAt: d.createdAt,
            })),
            search: {
              nameHighlight,
              senderHighlightTerms: null,
              contentHitData: null,
              source: 'service',
            },
          },
        ];
      }
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
            subType:
              result.sub_type === 'task'
                ? { type: 'task' }
                : result.sub_type === 'snippet'
                  ? { type: 'snippet' }
                  : null,
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
            linkId: result.link_id,
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
        return mapChannelSearchResultItem(
          {
            channel_id: result.channel_id,
            channel_type: result.channel_type,
            owner_id: result.owner_id,
            channel_message_search_results:
              result.channel_message_search_results,
          },
          channels()
        );
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

      case 'call': {
        if (!result.metadata) return [];
        const search = getSearchData({
          type: 'call_record',
          results: result.call_search_results,
          callId: result.call_id,
          callStartedAt: result.metadata.started_at,
        });

        const channelName: string | undefined =
          result.metadata.channel_name ??
          channels().find((c) => c.id === result.channel_id)?.name ??
          undefined;
        const status = result.metadata.status;

        return [
          {
            type: 'call',
            id: result.call_id,
            name: result.name ?? channelName ?? blockNameToDefaultFile('call'),
            channelId: result.channel_id,
            channelName,
            ownerId: result.owner_id,
            createdAt: result.metadata.started_at,
            updatedAt: result.metadata.updated_at,
            isActive: false,
            status,
            attended: status === 'ATTENDED',
            durationMs: result.metadata.duration_ms,
            participantIds: result.participant_ids,
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
            is_completed:
              'is_completed' in entity.subType
                ? entity.subType.is_completed
                : undefined,
          },
  });
};

export const isDisplayableSoupItem = (
  item: SoupPage['items'][number]
): item is DisplayableSoupItem => item.tag !== 'channelThread';

/**
 * The email soup query encodes "no sort timestamp" — e.g. a never-viewed thread
 * under the `viewed_at` sort — as the Unix epoch. Map it to `undefined` so each
 * soup view's sort and the row date fall back to their own column
 * (`updatedAt`/`createdAt`/`viewedAt`) instead of pinning the thread to 1970.
 */
function normalizeSentinelTs(
  ts: string | null | undefined
): string | undefined {
  if (!ts) return undefined;
  return Date.parse(ts) > 0 ? ts : undefined;
}

export const mapApiSoupItemToEntity = (item: DisplayableSoupItem): SoupEntity =>
  match(item)
    .with({ tag: 'chat' }, (item) => ({
      ...item.data,
      createdAt: item.data.createdAt,
      updatedAt: item.data.updatedAt,
      type: item.tag,
      name: item.data.name || 'New Chat',
      frecencyScore: item.frecency_score,
      viewedAt: item.data.viewedAt,
      projectId: item.data.projectId ?? undefined,
    }))
    .with({ tag: 'project' }, (item) => ({
      createdAt: item.data.createdAt,
      updatedAt: item.data.updatedAt,
      id: item.data.id,
      ownerId: item.data.ownerId,
      frecencyScore: item.frecency_score,
      viewedAt: item.data.viewedAt,
      projectId: item.data.parentId ?? undefined,
      type: item.tag,
      name: item.data.name || 'New Project',
    }))
    .with({ tag: 'emailThread' }, (item) => {
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

      // The thread preview has no link id of its own; its participants and
      // labels are scoped to the owning inbox, so they share its link id.
      const linkId =
        item.data.participants?.[0]?.linkId ?? item.data.labels?.[0]?.linkId;

      return {
        ...item.data,
        createdAt: item.data.createdAt,
        updatedAt: item.data.updatedAt,
        sortTs: normalizeSentinelTs(item.data.sortTs),
        senderEmail: item.data.senderEmail ?? undefined,
        senderName: item.data.senderName ?? undefined,
        snippet: item.data.snippet ?? undefined,
        done: !item.data.inboxVisible,
        type: 'email',
        name: item.data.name || 'Email Thread',
        frecencyScore: item.frecency_score,
        viewedAt: item.data.viewedAt,
        projectId: item.data.projectId ?? undefined,
        linkId,
        participants,
        hasIcsAttachment,
        attachments,
      } satisfies EmailEntity;
    })
    .with({ tag: 'call' }, (item) => {
      const status = item.data.status;

      return {
        type: 'call',
        id: item.data.callId,
        name:
          item.data.customName ??
          item.data.channelName ??
          blockNameToDefaultFile('call'),
        channelId: item.data.channelId,
        channelName: item.data.channelName ?? undefined,
        ownerId: item.data.createdBy,
        createdAt: item.data.startedAt,
        updatedAt: item.data.endedAt ?? item.data.startedAt,
        sortTs: item.data.endedAt ?? item.data.startedAt,
        isActive: item.data.isActive,
        status,
        attended: status === 'ATTENDED',
        durationMs: item.data.durationMs ?? undefined,
        participantIds: item.data.participants.map((p) => p.userId),
        summary: item.data.summary ?? undefined,
      } satisfies CallEntity;
    })
    .with({ tag: 'channel' }, (item) => {
      const latestMessage =
        item.data.latest_message ?? item.data.latest_non_thread_message;

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
        interactedAt: item.data.interacted_at,
        latestMessage: latestMessage
          ? {
              messageId: latestMessage.message_id,
              threadId: latestMessage.thread_id ?? undefined,
              content: latestMessage.content,
              senderId: latestMessage.sender_id,
              createdAt: latestMessage.created_at,
            }
          : undefined,
      };
      return out;
    })
    .with({ tag: 'foreignEntity' }, (item) => {
      const metadata = item.data.metadata as unknown as GithubPullRequest;

      let status: GithubPullRequestEntity['metadata']['status'] = 'open';

      if (metadata.status === 'merged') {
        status = 'merged';
      } else if (metadata.status === 'closed') {
        status = 'closed';
      }

      const out: GithubPullRequestEntity = {
        type: 'foreign',
        id: item.data.id,
        name: metadata.name ?? metadata.displayName,
        ownerId: item.data.storedForId,
        createdAt: item.data.createdAt,
        updatedAt: item.data.updatedAt,
        foreignSource: 'github_pull_request',
        foreignId: item.data.foreignEntityId,
        storedForId: item.data.storedForId,
        storedForAuthEntity: item.data.storedForAuthEntity,
        metadata: {
          number: metadata.number,
          name: metadata.name ?? metadata.displayName,
          owner: metadata.owner,
          repo: metadata.repo,
          url: metadata.url,
          status: status,
          additions: metadata.additions ?? 0,
          deletions: metadata.deletions ?? 0,
          comments: metadata.comments ?? [],
          checks: metadata.checks?.filter(Boolean) ?? [],
        },
      };

      return out;
    })
    .with({ tag: 'document' }, (item) => ({
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
              type: item.data.subType.type as NamedSubType,
              is_completed:
                'is_completed' in item.data.subType
                  ? item.data.subType.is_completed
                  : undefined,
            },
      name: resolveDocumentEntityName(item.data),
    }))
    .with({ tag: 'crmCompany' }, (item) => {
      const primaryDomain = item.data.domains[0]?.domain;
      return {
        type: 'crm_company',
        id: item.data.id,
        teamId: item.data.teamId,
        name: item.data.name || primaryDomain || 'Unknown Company',
        ownerId: item.data.teamId,
        description: item.data.description ?? undefined,
        emailSync: item.data.emailSync,
        hidden: item.data.hidden,
        createdAt: item.data.createdAt,
        updatedAt: item.data.updatedAt,
        sortTs: item.data.updatedAt,
        frecencyScore: item.frecency_score,
        domains: item.data.domains.map((d) => ({
          id: d.id,
          companyId: d.companyId,
          domain: d.domain,
          createdAt: d.createdAt,
        })),
      } satisfies CrmCompanyEntity;
    })
    .exhaustive();

export const isInstructionsMdDoc = (
  item: SoupApiItem,
  instructionsIdQuery: UseQueryResult<string | null | undefined, Error>
) => {
  if (item.tag !== 'document') return false;

  if (!instructionsIdQuery.isSuccess) return false;

  return item.data.id === instructionsIdQuery.data;
};

export const mapSoupPageToEntityList: (
  data: SoupPage,
  options: {
    instructionsIdQuery: UseQueryResult<string | null | undefined, Error>;
    showSupportedForeignEntities?: boolean;
  }
) => SoupEntity[] = (data, options) => {
  return data.items
    .filter((item): item is DisplayableSoupItem => {
      if (!isDisplayableSoupItem(item)) return false;

      if (item.tag === 'foreignEntity') {
        return (
          options.showSupportedForeignEntities === true &&
          item.data.foreignEntitySource === 'github_pull_request'
        );
      }

      return (
        item.tag !== 'document' ||
        !isInstructionsMdDoc(item, options.instructionsIdQuery)
      );
    })
    .map(mapApiSoupItemToEntity);
};
