/**
 * The documents the streamed sync's lanes run, sent with every stream
 * request. The server picks the lanes, their inputs and their order; the
 * field selection is this build's own, so a page never holds a field this
 * build's cache schema does not know, and a field the app adds to a fragment
 * reaches synced records with the build that adds it.
 */

import {
  CalendarOccurrencesDocument,
  CrmContactsDocument,
  SoupBackfillDocument,
  SoupBackfillSyncChannelsDocument,
  SoupBackfillSyncDocumentsDocument,
  SoupBackfillSyncTasksDocument,
  SoupMailBackfillDocument,
  SoupSyncChannelIdsDocument,
  SoupSyncDocumentIdsDocument,
  SoupSyncSharedEmailIdsDocument,
  SoupSyncTaskIdsDocument,
  SoupSyncTaskProjectIdsDocument,
} from '@service-storage/graphql/generated/graphql';
import { graphqlSoupTransportDocument } from '@service-storage/graphql-soup';
import { type DocumentNode, Kind, print } from 'graphql';

/**
 * Every operation a sync lane may run. The server leaves out a lane whose
 * operation is not here, so a lane added on the server waits for the build
 * that adds its operation.
 */
const LANE_DOCUMENTS: readonly DocumentNode[] = [
  CalendarOccurrencesDocument,
  CrmContactsDocument,
  SoupBackfillDocument,
  SoupBackfillSyncChannelsDocument,
  SoupBackfillSyncDocumentsDocument,
  SoupBackfillSyncTasksDocument,
  SoupMailBackfillDocument,
  SoupSyncChannelIdsDocument,
  SoupSyncDocumentIdsDocument,
  SoupSyncSharedEmailIdsDocument,
  SoupSyncTaskIdsDocument,
  SoupSyncTaskProjectIdsDocument,
];

function operationName(document: DocumentNode): string {
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION && definition.name) {
      return definition.name.value;
    }
  }
  throw new Error('sync lane document has no named operation');
}

let laneQueries: Readonly<Record<string, string>> | undefined;

/**
 * Each lane operation's document by name, as the GraphQL transport sends it
 * (without client-only directives). The cache writes a lane's pages with the
 * same document.
 */
export function syncLaneQueries(): Readonly<Record<string, string>> {
  laneQueries ??= Object.fromEntries(
    LANE_DOCUMENTS.map((document) => [
      operationName(document),
      graphqlSoupTransportDocument(print(document)),
    ])
  );
  return laneQueries;
}
