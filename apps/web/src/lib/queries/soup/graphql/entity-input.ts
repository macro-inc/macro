import {
  compileToAst,
  defineQueryFilters,
  type Query,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { match } from 'ts-pattern';
import type { SoupEntityTag } from '../normalized-cache/types';
import { makeGraphqlSoupInput } from './ast';

/** Canonical entity identity accepted by exact GraphQL Soup filters. */
export type GraphqlSoupEntityRef = {
  id: string;
  type: SoupEntityTag;
};

/** Builds an exact heterogeneous GraphQL Soup query using entity-id filters. */
export function makeGraphqlEntitySoupInput(entities: GraphqlSoupEntityRef[]) {
  const include: NonNullable<Query['include']> = {};
  for (const entity of entities) {
    match(entity.type)
      .with('calendarEvent', () => {
        include.calendarEventId = [
          ...(include.calendarEventId ?? []),
          entity.id,
        ];
      })
      .with('document', () => {
        include.documentId = [...(include.documentId ?? []), entity.id];
      })
      .with('project', () => {
        include.folderIdSelf = [...(include.folderIdSelf ?? []), entity.id];
      })
      .with('chat', () => {
        include.chatId = [...(include.chatId ?? []), entity.id];
      })
      .with('emailThread', () => {
        include.threadId = [...(include.threadId ?? []), entity.id];
      })
      .with('channel', () => {
        include.channelId = [...(include.channelId ?? []), entity.id];
      })
      .with('channelThread', () => {
        include.channelThreadId = [
          ...(include.channelThreadId ?? []),
          entity.id,
        ];
      })
      .with('call', () => {
        include.callId = [...(include.callId ?? []), entity.id];
      })
      .with('crmCompany', () => {
        include.crmCompanyId = [...(include.crmCompanyId ?? []), entity.id];
      })
      .with('foreignEntity', () => {
        include.foreignEntityRecordId = [
          ...(include.foreignEntityRecordId ?? []),
          entity.id,
        ];
      })
      .with('reminder', () => {
        include.reminderId = [...(include.reminderId ?? []), entity.id];
      })
      .exhaustive();
  }

  const query = defineQueryFilters({ include });
  const body = compileToAst(queryStateFrom({ ...query, emailView: 'all' }));
  return makeGraphqlSoupInput({
    params: {
      limit: Math.max(1, entities.length),
      sort_method: 'updated_at',
    },
    body,
  });
}
