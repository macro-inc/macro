import {
  searchClient as realSearchClient,
  type SearchArgs,
} from '@service-search/client';
import type { UnifiedSearchResponseItem } from '@service-search/generated/models';
import { storageServiceClient as realStorageClient } from '@service-storage/client';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';

export const [globalSearchRequests, setGlobalSearchRequests] = createSignal<
  unknown[]
>([]);
const timestamp = '2026-10-23T12:00:00Z';
const messages = [
  {
    id: 'julia-message',
    sender: 'macro|julia@macro.com',
    content: 'Julia shared the budget for next quarter.',
  },
  {
    id: 'john-message',
    sender: 'macro|john@example.com',
    content: 'John reviewed the budget forecast.',
  },
];
const documents: { name: string; subType?: 'task' | 'snippet' }[] = [
  { name: 'Investor update' },
  { name: 'Hiring plan' },
  { name: 'How Blowholes Work' },
  { name: 'Scope guide' },
  { name: 'Scope task', subType: 'task' },
  { name: 'Scope snippet', subType: 'snippet' },
];

export const searchClient = {
  ...realSearchClient,
  async search(args: SearchArgs) {
    setGlobalSearchRequests((previous) => [
      ...previous,
      { kind: 'search', ...args.request },
    ]);
    const query = args.request.query.toLowerCase();
    const senders = args.request.filters?.channel_filters?.sender_ids;
    const channelIds = args.request.filters?.channel_filters?.channel_ids;
    const documentsExcluded =
      args.request.filters?.document_filters?.document_ids?.includes(
        '00000000-0000-0000-0000-000000000000'
      );
    const results: UnifiedSearchResponseItem[] = [];
    for (const message of messages) {
      if (senders?.length && !senders.includes(message.sender)) continue;
      if (channelIds?.length && !channelIds.includes('sales-channel')) continue;
      if (!message.content.toLowerCase().includes(query)) continue;
      results.push({
        type: 'channelMessage',
        id: 'sales-channel',
        channel_id: 'sales-channel',
        channel_type: 'public',
        message_id: message.id,
        sender_id: message.sender,
        highlight: { content: [message.content] },
        created_at: timestamp,
        updated_at: timestamp,
      });
    }
    if (!documentsExcluded)
      for (const [index, { name, subType }] of documents.entries()) {
        if (!name.toLowerCase().includes(query)) continue;
        results.push({
          type: 'document',
          id: `search-document-${index}`,
          document_id: `search-document-${index}`,
          document_name: name,
          name,
          owner_id: 'fixture',
          file_type: 'md',
          sub_type: subType,
          document_search_results: [],
          metadata: { created_at: timestamp, updated_at: timestamp },
        });
      }
    return ok({ results, next_cursor: null });
  },
};

export const storageServiceClient = {
  ...realStorageClient,
  async getSoupAstItems(
    args: Parameters<typeof realStorageClient.getSoupAstItems>[0]
  ) {
    setGlobalSearchRequests((previous) => [
      ...previous,
      { kind: 'browse', ...args.body },
    ]);
    return ok({ items: [], next_cursor: null });
  },
};
