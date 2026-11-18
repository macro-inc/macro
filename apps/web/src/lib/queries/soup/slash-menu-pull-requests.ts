import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { isGithubPrEntity } from '@entity';
import { type Accessor, createMemo } from 'solid-js';
import { queryReadyGate } from '../gate';
import { type SoupAstItemsQueryArgs, useSoupAstItemsQuery } from './items';

/** GitHub pull requests only, recently opened first. */
export const SLASH_MENU_PULL_REQUESTS_ARGS: SoupAstItemsQueryArgs = {
  params: { limit: 500, sort_method: 'viewed_updated' },
  body: compileToAst(
    queryStateFrom(
      defineQueryFilters({
        include: { foreignEntitySource: ['github_pull_request'] },
      })
    )
  ),
};

/** Accessible pull requests, using the same live feed as the PR list. */
export function useSlashMenuPullRequests(enabled: Accessor<boolean>) {
  const query = useSoupAstItemsQuery(
    () => SLASH_MENU_PULL_REQUESTS_ARGS,
    () => ({
      enabled: enabled(),
      showSupportedForeignEntities: true,
      ignoresNotifications: true,
    })
  );
  const pullRequests = createMemo(() =>
    queryReadyGate(query) ? query.data.entities.filter(isGithubPrEntity) : []
  );
  return { query, pullRequests };
}
