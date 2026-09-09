import {
  clause,
  compileClause,
  compileFacets,
  confine,
  type FacetSelection,
  mergeAst,
  NIL_UUID,
  type TargetExpr,
} from '@app/features/soup';
import type { SoupAstBody, SoupAstItemsQueryArgs } from '@queries/soup/items';
import { match } from 'ts-pattern';
import { EMAIL_FACETS } from '../filters/email-facets';
import type { EmailTab } from '../types';

export type EmailQueryContext = {
  tab: EmailTab;
  /** `undefined` = every linked inbox; `[]` = none; otherwise email link ids. */
  inboxIds: string[] | undefined;
  facets: FacetSelection;
};

/**
 * The mailbox slice the server lists for each tab. Mirrors the legacy
 * `VIEW_TAB_PRESETS.mail` presets.
 */
export const emailViewForTab = (tab: EmailTab): string =>
  match(tab)
    .with('important', 'noise', () => 'inbox')
    .with('drafts', () => 'drafts')
    .with('sent', () => 'sent')
    .with('calendar', 'shared', 'all', () => 'all')
    .exhaustive();

const anyThread = (): TargetExpr => clause.not(clause.eq('threadId', NIL_UUID));

// Deliberately no `!isDraft` exclusion here: `isDraft` is thread-level, so
// excluding it hid whole conversations the moment a reply draft saved (#5940).
function tabClause(tab: EmailTab): TargetExpr {
  return (
    match(tab)
      .with('important', () =>
        clause.and(
          clause.eq('emailImportance', true),
          clause.eq('emailShared', 'exclude')
        )
      )
      .with('noise', () =>
        clause.and(
          clause.eq('emailImportance', false),
          clause.eq('emailShared', 'exclude')
        )
      )
      .with('calendar', () =>
        clause.and(
          clause.eq('emailShared', 'exclude'),
          clause.eq('emailCalendarOnly', true)
        )
      )
      .with('shared', () => clause.eq('emailShared', 'only'))
      // Sent and Drafts are scoped entirely by `emailView`; the server's sent
      // view already covers every linked inbox, so no sender filter is needed.
      .with('drafts', 'sent', 'all', anyThread)
      .exhaustive()
  );
}

/**
 * Scopes the list to the selected inboxes. No selection means every inbox
 * (no clause); an explicit empty selection matches nothing, like the legacy
 * view's `emailLinkId: [NIL_UUID]`.
 */
function inboxClause(inboxIds: string[] | undefined): TargetExpr | undefined {
  if (inboxIds === undefined) return undefined;
  if (inboxIds.length === 0) return clause.eq('emailLinkId', NIL_UUID);

  return clause.or(...inboxIds.map((id) => clause.eq('emailLinkId', id)));
}

/** Builds the email-only Soup AST for the composable Email view. */
export function buildEmailQuery(
  context: EmailQueryContext
): SoupAstItemsQueryArgs {
  const expressions = [tabClause(context.tab)];
  const inbox = inboxClause(context.inboxIds);
  if (inbox) expressions.push(inbox);

  const base = compileClause(confine({ ef: clause.and(...expressions) }));
  const refinements = compileFacets(context.facets, EMAIL_FACETS, undefined);
  const body: SoupAstBody = {
    ...mergeAst(base, refinements),
    emailView: emailViewForTab(context.tab),
  };

  // Newest activity first: `updated_at` is the thread's latest message time.
  return {
    params: {
      expand: true,
      limit: 100,
      sort_method: 'updated_at',
      sort_direction: 'desc',
    },
    body,
  };
}
