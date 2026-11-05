/**
 * Search across the user's Macro content.
 *
 * @routing Use when finding, looking up or listing the user's own Macro content across documents, messages, email or calls, or asking something their workspace answers; not the web, and not one item already in context.
 *
 * @agent
 * Search within the user's requested entities. macro.documents.search returns document handles; macro.email.search returns email threads. SearchOpts selects searchOn: 'name', 'content', or 'name_content'. These SDK iterators auto-paginate when the backend returns a cursor. Explicitly bound work; record when you stop before exhaustion. Do not carry over the old tool response's {results} wrapper or its fixed no-cursor contract.
 *
 * ```javascript
 * export async function main({macro}) {
 *   const queries = ['launch decision', 'release readiness'];
 *   const outcomes = await Promise.allSettled(queries.map(async query => {
 *     const evidence = [];
 *     let stoppedEarly = false;
 *     for await (const document of macro.documents.search(query, {searchOn:'content'})) {
 *       if (evidence.length === 5) { stoppedEarly = true; break; }
 *       evidence.push({id:document.id, text:(await document.content()).slice(0,3000)});
 *     }
 *     return {query,evidence,stoppedEarly};
 *   }));
 *   return {data: outcomes.map((item,index) => item.status === 'fulfilled'
 *     ? item.value : {query:queries[index],error:String(item.reason)}), reviews:[]};
 * }
 * ```
 * Preserve useful evidence from each query. A short sample cannot establish corpus-wide completeness or absence. Use precise terms, metadata and relevant reads before expanding breadth. Do not swallow rejected branches. Normal for/while/for-await with break and sequential dependent calls are supported.
 *
 * Skills are instructions to follow. When a request names a skill that is not attached, find it by name with macro.documents.skills({query}), which includes built-in skills, read its instructions with skill.content() before doing the task, and follow them for that request only.
 *
 * @packageDocumentation
 */

import type {
  EntityFilters,
  UnifiedSearchResponseItem,
} from '../../generated/search/types.gen';
import { paginate, unwrap } from '../utils';
import type { MacroClient } from '../utils/client';

type Hit = UnifiedSearchResponseItem;

export type SearchOn = 'name' | 'content' | 'name_content';

const DEFAULT_SEARCH_PAGE_SIZE = 50;

export interface SearchOpts {
  searchOn?: SearchOn;
  pageSize?: number;
}

/**
 * Build a `search(client, query, opts?)` function for one entity type: unified
 * search hits narrowed to `type`, each mapped through `make`.
 * Most relevant first, auto-paginated.
 */
export function entitySearch<T, K extends Hit['type']>(opts: {
  filters?: EntityFilters;
  type: K;
  make: (client: MacroClient, hit: Extract<Hit, { type: K }>) => T;
  /** Opt in to CRM results (off by default server-side; required for company hits). */
  includeCrm?: boolean;
}): (
  client: MacroClient,
  query: string,
  searchOpts?: SearchOpts,
) => AsyncGenerator<T> {
  const { filters, type, make, includeCrm } = opts;
  return (client, query, searchOpts) => {
    const searchOn = searchOpts?.searchOn ?? 'name_content';
    const pageSize = searchOpts?.pageSize ?? DEFAULT_SEARCH_PAGE_SIZE;
    return paginate(async (cursor) => {
      const { results, next_cursor } = unwrap(
        await client.search.unifiedSearch({
          body: {
            query,
            match_type: 'partial',
            search_on: searchOn,
            ...(filters ? { filters } : {}),
            ...(includeCrm ? { include_crm: true } : {}),
          },
          query: {
            page_size: pageSize,
            ...(cursor ? { cursor } : {}),
          },
        }),
      );
      const hits = results.filter(
        (r): r is Extract<Hit, { type: K }> => r.type === type,
      );
      return {
        items: hits.map((h) => make(client, h)),
        nextCursor: next_cursor,
      };
    });
  };
}
