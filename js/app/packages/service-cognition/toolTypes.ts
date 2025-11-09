/** Manually provided types for the schema files */

import type { FlattenArray } from '@core/util/flatten';
import type * as types from './generated/tools/types';

export enum UnifiedSearchTypeEnum {
  document = 'document',
  chat = 'chat',
  email = 'email',
  channel = 'channel',
  project = 'project',
}

/** maps to a grouping of results for a given type
 * e.g. a single document id match can have multiple content results
 */
export type UnifiedSearchResult = FlattenArray<
  types.UnifiedSearchOutput['response']['results']
>;

export type ListDocumentsResult = FlattenArray<
  types.ListDocumentsOutput['results']
>;

export type ListEmailsResult = FlattenArray<
  types.ListEmailsOutput['previews']['items']
>;
