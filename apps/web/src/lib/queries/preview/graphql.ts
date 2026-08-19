import { userNameQueryOptions } from '@queries/auth';
import { makeGraphqlEntitySoupInput } from '@queries/soup/graphql/entity-input';
import type { ItemType } from '@service-storage/client';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import {
  SoupDocument,
  type SoupQuery,
  type SoupQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  mapGraphqlSoupPage,
} from '@service-storage/graphql-soup';
import { queryClient } from '../client';
import type { ItemEntity, PreviewItem } from './types';

const GRAPHQL_PREVIEW_TYPES = [
  'chat',
  'call',
  'channel',
  'document',
  'project',
  'email',
  'crm_company',
] as const satisfies readonly ItemType[];

type GraphqlPreviewType = (typeof GRAPHQL_PREVIEW_TYPES)[number];

function isGraphqlPreviewType(
  type: ItemEntity['type']
): type is GraphqlPreviewType {
  return (
    type !== undefined &&
    GRAPHQL_PREVIEW_TYPES.includes(type as GraphqlPreviewType)
  );
}

function soupTag(type: GraphqlPreviewType) {
  switch (type) {
    case 'email':
      return 'emailThread' as const;
    case 'crm_company':
      return 'crmCompany' as const;
    default:
      return type;
  }
}

/** Builds the same exact-id Soup filters used by single-entity refetches. */
export function makeGraphqlPreviewInput(items: ItemEntity[]) {
  return makeGraphqlEntitySoupInput(
    items.flatMap((item) =>
      isGraphqlPreviewType(item.type)
        ? [{ id: item.id, type: soupTag(item.type) }]
        : []
    )
  );
}

function documentPreview(item: Extract<SoupApiItem, { tag: 'document' }>) {
  return {
    id: item.data.id,
    type: 'document',
    access: 'access',
    loading: false,
    rawName: item.data.name,
    name: item.data.name,
    fileType: (item.data.fileType ?? undefined) as FileType | undefined,
    owner: item.data.ownerId,
    updatedAt: item.data.updatedAt,
    subType: item.data.subType,
  } satisfies PreviewItem;
}

function soupItemToPreview(
  item: SoupApiItem,
  directMessageNames: ReadonlyMap<string, string>
): PreviewItem | undefined {
  switch (item.tag) {
    case 'document':
      return documentPreview(item);
    case 'chat':
      return {
        id: item.data.id,
        type: 'chat',
        access: 'access',
        loading: false,
        rawName: item.data.name,
        name: item.data.name,
        owner: item.data.ownerId,
        updatedAt: item.data.updatedAt,
      };
    case 'project':
      return {
        id: item.data.id,
        type: 'project',
        access: 'access',
        loading: false,
        rawName: item.data.name,
        name: item.data.name,
        owner: item.data.ownerId,
        updatedAt: item.data.updatedAt,
      };
    case 'emailThread': {
      const name = item.data.name ?? 'No Subject';
      return {
        id: item.data.id,
        type: 'email',
        access: 'access',
        loading: false,
        rawName: name,
        name,
        owner:
          item.data.senderEmail ?? item.data.senderName ?? item.data.ownerId,
        updatedAt: item.data.updatedAt,
      };
    }
    case 'channel': {
      const name =
        item.data.channel.name ??
        directMessageNames.get(item.data.channel.id) ??
        '';
      return {
        id: item.data.channel.id,
        type: 'channel',
        access: 'access',
        loading: false,
        rawName: name,
        name,
        channelType: item.data.channel.channel_type,
      };
    }
    case 'call': {
      const name = item.data.customName ?? item.data.channelName ?? '';
      return {
        id: item.data.callId,
        type: 'call',
        access: 'access',
        loading: false,
        rawName: name,
        name: name || 'Unknown Call',
        updatedAt: item.data.startedAt,
      };
    }
    case 'crmCompany': {
      const name =
        item.data.name ?? item.data.domains[0]?.domain ?? 'Unknown Company';
      return {
        id: item.data.id,
        type: 'crm_company',
        access: 'access',
        loading: false,
        rawName: name,
        name,
        updatedAt: item.data.updatedAt,
      };
    }
    default:
      return undefined;
  }
}

function fallbackUserName(userId: string): string {
  return userId.startsWith('macro|') ? userId.slice('macro|'.length) : userId;
}

async function directMessageNames(
  items: SoupApiItem[],
  currentUserId: string
): Promise<ReadonlyMap<string, string>> {
  const channels = items.filter(
    (item): item is Extract<SoupApiItem, { tag: 'channel' }> =>
      item.tag === 'channel' &&
      item.data.channel.channel_type === 'direct_message' &&
      !item.data.channel.name
  );
  const names = await Promise.all(
    channels.map(async (item) => {
      const participants = item.data.participants;
      const recipient =
        participants.find(
          (participant) => participant.user_id !== currentUserId
        ) ?? participants[0];
      if (!recipient) return [item.data.channel.id, ''] as const;
      try {
        const userName = await queryClient.fetchQuery(
          userNameQueryOptions(recipient.user_id)
        );
        const displayName = [userName?.first_name, userName?.last_name]
          .filter(Boolean)
          .join(' ')
          .trim();
        return [
          item.data.channel.id,
          displayName || fallbackUserName(recipient.user_id),
        ] as const;
      } catch {
        return [
          item.data.channel.id,
          fallbackUserName(recipient.user_id),
        ] as const;
      }
    })
  );
  return new Map(names);
}

async function mapPreviewData(
  data: SoupQuery
): Promise<Map<string, PreviewItem>> {
  const items = mapGraphqlSoupPage(data).items;
  const dmNames = await directMessageNames(items, data.user.id);
  const previews = new Map<string, PreviewItem>();
  for (const item of items) {
    const preview = soupItemToPreview(item, dmNames);
    if (preview) previews.set(preview.id, preview);
  }
  return previews;
}

function isCompletePreviewBatch(
  items: Array<ItemEntity & { type: GraphqlPreviewType }>,
  previews: Map<string, PreviewItem>
): boolean {
  return items.every((item) => previews.get(item.id)?.type === item.type);
}

/** Fetches one coalesced preview batch through the normalized GraphQL Soup client. */
export async function fetchGraphqlPreviewBatch(
  items: ItemEntity[]
): Promise<Map<string, PreviewItem>> {
  const supported = items.filter(
    (item): item is ItemEntity & { type: GraphqlPreviewType } =>
      isGraphqlPreviewType(item.type)
  );
  if (supported.length === 0) return new Map();

  const variables: SoupQueryVariables = {
    input: makeGraphqlPreviewInput(supported),
  };
  const client = getGraphqlSoupClient();
  const cached = await client
    .query<SoupQuery, SoupQueryVariables>(SoupDocument, variables, {
      requestPolicy: 'cache-only',
    })
    .toPromise();
  if (cached.data) {
    const cachedPreviews = await mapPreviewData(cached.data);
    if (isCompletePreviewBatch(supported, cachedPreviews)) {
      return cachedPreviews;
    }
  }

  const network = await client
    .query<SoupQuery, SoupQueryVariables>(SoupDocument, variables, {
      requestPolicy: 'network-only',
    })
    .toPromise();
  if (network.error) throw network.error;
  if (!network.data) throw new Error('GraphQL preview query returned no data');
  return await mapPreviewData(network.data);
}
