import {
  clause,
  compileClause,
  compileFacets,
  confine,
  type FacetClause,
  type FacetSelection,
  mergeAst,
  NIL_UUID,
  type TargetExpr,
} from '@app/features/soup';
import type { SoupAstBody, SoupAstItemsQueryArgs } from '@queries/soup/items';
import { startOfDay, subWeeks } from 'date-fns';
import { match } from 'ts-pattern';
import { INBOX_FACETS, type InboxFacetContext } from '../inbox-facets';
import type { InboxTab } from '../types';

export type InboxQueryCapabilities = {
  calendar: boolean;
  foreignEntities: boolean;
  reminders: boolean;
  snippets: boolean;
};

function visibleEntity(field: string): TargetExpr {
  return clause.not(clause.eq(field, NIL_UUID));
}

function documentClause(
  expressions: TargetExpr[],
  capabilities: InboxQueryCapabilities
): TargetExpr {
  if (capabilities.snippets) return clause.and(...expressions);

  return clause.and(
    ...expressions,
    clause.not(clause.eq('subType', 'snippet'))
  );
}

function signalClause(
  capabilities: InboxQueryCapabilities,
  now: Date,
  userId: string | undefined
): FacetClause {
  const recent = subWeeks(startOfDay(now), 2).toISOString();

  const filters: FacetClause = {
    df: documentClause(
      [
        clause.eq('documentDone', false),
        clause.eq('documentUpdatedAt', { gte: recent }),
      ],
      capabilities
    ),
    ef: clause.and(
      clause.eq('emailDone', false),
      clause.eq('emailImportance', true),
      clause.eq('emailUpdatedAt', { gte: recent }),
      clause.eq('emailShared', 'exclude')
    ),
    chanf: clause.and(
      clause.eq('channelDone', false),
      clause.eq('channelIsParticipant', true)
    ),
    cthf: clause.and(
      clause.eq('channelThreadDone', false),
      clause.eq('channelThreadParticipantId', userId ?? NIL_UUID)
    ),
    cf: clause.and(
      clause.eq('chatDone', false),
      clause.eq('chatUpdatedAt', { gte: recent })
    ),
    pf: clause.and(
      clause.eq('folderDone', false),
      clause.eq('folderUpdatedAt', { gte: recent })
    ),
  };

  if (capabilities.foreignEntities) {
    filters.fef = clause.and(
      clause.eq('foreignEntitySource', 'github_pull_request'),
      clause.eq('foreignEntityDone', false),
      clause.eq('foreignEntityIncludesMe', true)
    );
  }

  if (capabilities.reminders) {
    filters.remf = clause.eq('includeReminders', true);
  }

  if (capabilities.calendar) {
    filters.calf = clause.eq('calendarEventDone', false);
  }

  return confine(filters);
}

function noiseClause(): FacetClause {
  return confine({
    ef: clause.and(
      clause.eq('emailDone', false),
      clause.eq('emailImportance', false),
      clause.eq('emailShared', 'exclude')
    ),
  });
}

function allClause(capabilities: InboxQueryCapabilities): FacetClause {
  const filters: FacetClause = {
    df: documentClause([visibleEntity('documentId')], capabilities),
    ef: visibleEntity('threadId'),
    chanf: visibleEntity('channelId'),
    cf: visibleEntity('chatId'),
    pf: visibleEntity('folderId'),
  };

  if (capabilities.foreignEntities) {
    filters.fef = clause.and(
      clause.eq('foreignEntitySource', 'github_pull_request'),
      clause.eq('foreignEntityIncludesMe', true)
    );
  }

  return confine(filters);
}

function remindersClause(): FacetClause {
  return confine({
    remf: clause.and(
      clause.eq('includeReminders', true),
      clause.eq('reminderCompleted', false),
      clause.eq('reminderFired', false)
    ),
  });
}

function tabClause(
  tab: InboxTab,
  capabilities: InboxQueryCapabilities,
  now: Date,
  userId: string | undefined
): FacetClause {
  return match(tab)
    .with('signal', () => signalClause(capabilities, now, userId))
    .with('noise', noiseClause)
    .with('all', () => allClause(capabilities))
    .with('reminders', remindersClause)
    .exhaustive();
}

export type BuildInboxQueryOptions = {
  tab: InboxTab;
  facets: FacetSelection;
  facetContext: InboxFacetContext;
  capabilities: InboxQueryCapabilities;
  userId: string | undefined;
  now?: Date;
};

/** Builds the heterogeneous Soup AST for the composable Inbox view. */
export function buildInboxQuery(
  options: BuildInboxQueryOptions
): SoupAstItemsQueryArgs {
  const base = compileClause(
    tabClause(
      options.tab,
      options.capabilities,
      options.now ?? new Date(),
      options.userId
    )
  );
  const refinements = compileFacets(
    options.facets,
    INBOX_FACETS,
    options.facetContext
  );
  const body: SoupAstBody = mergeAst(base, refinements);

  if (options.tab === 'signal' || options.tab === 'noise') {
    body.emailView = 'inbox';
  } else if (options.tab === 'all') {
    body.emailView = 'all';
  }

  return {
    params: {
      expand: true,
      limit: 100,
      sort_method: 'updated_at',
      sort_direction: options.tab === 'reminders' ? 'asc' : 'desc',
    },
    body,
  };
}
