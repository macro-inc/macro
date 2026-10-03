import {
  agentDetailSearch,
  agentDetailSearchCodec,
} from '@app/features/block-agent/agent-route';
import {
  callDetailSearch,
  callDetailSearchCodec,
} from '@app/features/block-call/call-route';
import {
  markdownDetailSearch,
  markdownDetailSearchCodec,
} from '@app/features/block-md/markdown-route';
import {
  pdfDetailSearch,
  pdfDetailSearchCodec,
} from '@app/features/block-pdf/pdf-route';
import {
  channelsSearch,
  channelsSearchCodec,
} from '@app/features/channels-view/channels-route';
import {
  emailDetailSearch,
  emailDetailSearchCodec,
} from '@app/features/email-view/email-route';
import type {
  SerializedSearchParams,
  SplitSearchUpdate,
} from '@app/split-router';
import type { SearchLocation } from '@entity';
import { match } from 'ts-pattern';

/** One navigation request per click, including repeated clicks on the same hit. */
export function searchLocationTarget(
  entityId: string,
  location: SearchLocation,
  seek: string = crypto.randomUUID()
): {
  namespace: string;
  params: SerializedSearchParams;
  fields: readonly string[];
} {
  return match(location)
    .with({ type: 'channel' }, (target) => ({
      namespace: channelsSearch.namespace,
      params: channelsSearchCodec.serialize({
        ...channelsSearch.defaults,
        messageId: target.messageId,
        threadId: target.threadId ?? '',
        seek,
      })!,
      fields: ['messageId', 'threadId', 'seek'],
    }))
    .with({ type: 'email' }, (target) => ({
      namespace: emailDetailSearch.namespace,
      params: emailDetailSearchCodec.serialize({
        messageId: target.messageId,
        seek,
      })!,
      fields: ['messageId', 'seek'],
    }))
    .with({ type: 'md' }, (target) => ({
      namespace: markdownDetailSearch.namespace,
      params: markdownDetailSearchCodec.serialize({
        documentId: entityId,
        nodeId: target.nodeId,
        seek,
      })!,
      fields: ['documentId', 'nodeId', 'seek'],
    }))
    .with({ type: 'pdf' }, (target) => ({
      namespace: pdfDetailSearch.namespace,
      params: pdfDetailSearchCodec.serialize({
        documentId: entityId,
        page: target.searchPage,
        highlightTerms: target.highlightTerms,
        snippet: target.searchSnippet,
        query: target.searchRawQuery,
        seek,
      })!,
      fields: [
        'documentId',
        'page',
        'highlightTerms',
        'snippet',
        'query',
        'seek',
      ],
    }))
    .with({ type: 'agent' }, (target) => ({
      namespace: agentDetailSearch.namespace,
      params: agentDetailSearchCodec.serialize({
        messageTurn: target.messageTurn,
        author: target.author,
        seek,
      })!,
      fields: ['messageTurn', 'author', 'seek'],
    }))
    .with({ type: 'call_record' }, (target) => ({
      namespace: callDetailSearch.namespace,
      params: callDetailSearchCodec.serialize({
        transcriptId: target.transcriptId,
        messageId: '',
        seek,
      })!,
      fields: ['transcriptId', 'messageId', 'seek'],
    }))
    .exhaustive();
}

/** Replace the whole target while preserving unrelated fields, such as the Chat tab. */
export function searchLocationUpdates(
  entityId: string,
  location: SearchLocation
): Record<string, SplitSearchUpdate> {
  const target = searchLocationTarget(entityId, location);
  return {
    [target.namespace]: (current) => ({
      ...Object.fromEntries(
        Object.entries(current ?? {}).filter(
          ([field]) => !target.fields.includes(field)
        )
      ),
      ...target.params,
    }),
  };
}
