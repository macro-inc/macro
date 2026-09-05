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
  notifiedSort: boolean;
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

function allClause(
  capabilities: InboxQueryCapabilities,
  userId: string | undefined
): FacetClause {
  const filters: FacetClause = {
    df: documentClause([visibleEntity('documentId')], capabilities),
    ef: visibleEntity('threadId'),
    chanf: visibleEntity('channelId'),
    cthf: clause.eq('channelThreadParticipantId', userId ?? NIL_UUID),
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
    .with('all', () => allClause(capabilities, userId))
    .with('reminders', remindersClause)
    .exhaustive();
}

export type InboxViewContext = {
  tab: InboxTab;
  facets: FacetSelection;
  facetContext: InboxFacetContext;
  capabilities: InboxQueryCapabilities;
  userId: string | undefined;
};

/**
 * Signal and Noise are notification feeds: a row belongs where its latest
 * notification puts it, not where its content's last edit does — a comment
 * on a week-old task is today's news. The server sort is also a filter (rows
 * without a notification are absent), which is what those tabs mean anyway.
 */
export const inboxTabOrdersByNotification = (
  context: Pick<InboxViewContext, 'tab' | 'capabilities'>
): boolean =>
  context.capabilities.notifiedSort &&
  (context.tab === 'signal' || context.tab === 'noise');

/** Builds the heterogeneous Soup AST for the composable Inbox view. */
export function buildInboxQuery(
  context: InboxViewContext,
  options: { now?: Date } = {}
): SoupAstItemsQueryArgs {
  const base = compileClause(
    tabClause(
      context.tab,
      context.capabilities,
      options.now ?? new Date(),
      context.userId
    )
  );
  const refinements = compileFacets(
    context.facets,
    INBOX_FACETS,
    context.facetContext
  );
  const body: SoupAstBody = mergeAst(base, refinements);

  if (context.tab === 'signal' || context.tab === 'noise') {
    body.emailView = 'inbox';
  } else if (context.tab === 'all') {
    body.emailView = 'all';
  }

  return {
    params: {
      expand: true,
      limit: 100,
      sort_method: inboxTabOrdersByNotification(context)
        ? 'notified_at'
        : 'updated_at',
      sort_direction: context.tab === 'reminders' ? 'asc' : 'desc',
    },
    body,
  };
}
