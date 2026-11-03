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
import {
  EMAIL_ATTACHMENT_KINDS,
  EMAIL_FACETS,
  type EmailFacetContext,
} from '../filters/email-facets';
import type {
  EmailParticipantField,
  EmailTab,
  EmailViewConditions,
} from '../types';

/** A saved view's conditions with its relative parts resolved for one query. */
export type EmailSavedViewScope = {
  conditions: EmailViewConditions;
  /** The viewer's inbox addresses, standing in for a `viewer` participant. */
  viewerAddresses: readonly string[];
  /** Start of the received window, when the view has one. */
  receivedSince?: string;
};

export type EmailQueryContext = {
  tab: EmailTab;
  /** `undefined` = every linked inbox; `[]` = none; otherwise email link ids. */
  inboxIds: string[] | undefined;
  aliasFilter?: { inboxId: string; emailAddress: string };
  facets: FacetSelection;
  facetContext: EmailFacetContext;
  /** Macro favorite IDs used only by the separate text-search service. */
  favoriteThreadIds?: readonly string[];
  /** An open saved view replaces the tab's own slice of the mailbox. */
  savedView?: EmailSavedViewScope;
};

/**
 * The mailbox slice the server lists for each tab. Mirrors the legacy
 * `VIEW_TAB_PRESETS.mail` presets.
 */
export const emailViewForTab = (tab: EmailTab): string =>
  match(tab)
    .with('important', 'noise', () => 'inbox')
    .with('drafts', () => 'drafts')
    // Scheduled has a dedicated REST-backed message list. Keep the dormant
    // Soup source on drafts so its query shape remains valid while disabled.
    .with('scheduled', () => 'drafts')
    .with('sent', () => 'sent')
    .with(
      'favorites',
      'calendar',
      'shared',
      'all',
      'reminders',
      'archived',
      // Focus has a dedicated GraphQL list; the dormant Soup source stays valid.
      'focus',
      () => 'all'
    )
    .exhaustive(() => 'all');

const anyThread = (): TargetExpr => clause.not(clause.eq('threadId', NIL_UUID));

// Preserve a shallow tree through both the REST and GraphQL AST compilers.
// A flat 100-way clause.or becomes a linear tree and exceeds JSON ingress depth.
function balancedOr(clauses: readonly TargetExpr[]): TargetExpr | undefined {
  if (clauses.length < 2) return clauses[0];
  const middle = Math.floor(clauses.length / 2);
  const left = balancedOr(clauses.slice(0, middle));
  const right = balancedOr(clauses.slice(middle));
  return left && right ? clause.or(left, right) : (left ?? right);
}

function threadIdsClause(ids: readonly string[]): TargetExpr {
  return (
    balancedOr(ids.map((id) => clause.eq('threadId', id))) ??
    clause.eq('threadId', NIL_UUID)
  );
}

const ADDRESS_FIELDS = {
  from: 'emailSenderAddress',
  to: 'emailRecipientAddress',
  cc: 'emailCcAddress',
  bcc: 'emailBccAddress',
} as const satisfies Record<EmailParticipantField, string>;

const DOMAIN_FIELDS = {
  from: 'emailSenderDomain',
  to: 'emailRecipientDomain',
  cc: 'emailCcDomain',
  bcc: 'emailBccDomain',
} as const satisfies Record<EmailParticipantField, string>;

/** Any chosen person in any chosen field; a viewer with no inbox matches nothing. */
function participantsClause(scope: EmailSavedViewScope): TargetExpr {
  const { participants, participantFields } = scope.conditions;
  const addresses = new Set<string>();
  const domains = new Set<string>();
  for (const person of participants) {
    match(person)
      .with({ type: 'viewer' }, () => {
        for (const address of scope.viewerAddresses)
          addresses.add(address.toLowerCase());
      })
      .with({ type: 'address' }, ({ email }) =>
        addresses.add(email.toLowerCase())
      )
      .with({ type: 'domain' }, ({ domain }) =>
        domains.add(domain.toLowerCase())
      )
      // A person kind this build doesn't know adds no one.
      .exhaustive(() => undefined);
  }
  const leaves = participantFields.flatMap((field) => [
    ...[...addresses].map((address) =>
      clause.eq(ADDRESS_FIELDS[field], address)
    ),
    ...[...domains].map((domain) => clause.eq(DOMAIN_FIELDS[field], domain)),
  ]);
  return balancedOr(leaves) ?? clause.eq('threadId', NIL_UUID);
}

const isAttachmentFilter = (
  id: string
): id is keyof typeof EMAIL_ATTACHMENT_KINDS => id in EMAIL_ATTACHMENT_KINDS;

/** Each condition narrows the view; alternatives within one are OR'd. */
function savedViewClause(
  scope: EmailSavedViewScope,
  facets: EmailQueryContext['facets']
): TargetExpr {
  const { conditions } = scope;
  const expressions: TargetExpr[] = [clause.eq('emailShared', 'exclude')];
  if (conditions.importance)
    expressions.push(
      clause.eq('emailImportance', conditions.importance === 'signal')
    );
  if (conditions.participants.length > 0)
    expressions.push(participantsClause(scope));
  const subject = balancedOr(
    conditions.subject.map((keyword) => clause.eq('emailSubject', keyword))
  );
  if (subject) expressions.push(subject);
  if (scope.receivedSince)
    expressions.push(clause.eq('emailUpdatedAt', { gte: scope.receivedSince }));
  // Pages would come back short if attachments only refined them locally.
  const attachments = balancedOr(
    (facets.attachments ?? [])
      .filter(isAttachmentFilter)
      .map((id) => clause.eq('emailAttachment', EMAIL_ATTACHMENT_KINDS[id]))
  );
  if (attachments) expressions.push(attachments);
  return clause.and(...expressions);
}

// Deliberately no `!isDraft` exclusion here: `isDraft` is thread-level, so
// excluding it hid whole conversations the moment a reply draft saved (#5940).
function tabClause(context: EmailQueryContext): TargetExpr {
  return (
    match(context.tab)
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
      .with('archived', () =>
        clause.and(
          clause.eq('emailDone', true),
          clause.eq('emailShared', 'exclude')
        )
      )
      // Sent and Drafts are scoped entirely by `emailView`; the server's sent
      // view already covers every linked inbox, so no sender filter is needed.
      .with(
        'drafts',
        'scheduled',
        'sent',
        'favorites',
        'all',
        'reminders',
        'focus',
        anyThread
      )
      .exhaustive(anyThread)
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

/** Discovery keeps the server read filter ahead of pagination. ID-scoped
 * admission lookups drop only read status; all other membership rules remain. */
export function buildEmailQuery(
  context: EmailQueryContext,
  admittedIds?: readonly string[]
): SoupAstItemsQueryArgs {
  const expressions = [
    context.savedView
      ? savedViewClause(context.savedView, context.facets)
      : tabClause(context),
  ];
  if (admittedIds) {
    expressions.push(threadIdsClause(admittedIds));
  }
  const inbox = inboxClause(context.inboxIds);
  if (inbox) expressions.push(inbox);
  if (context.aliasFilter) {
    const { inboxId, emailAddress } = context.aliasFilter;
    const address = emailAddress.toLowerCase();
    expressions.push(
      clause.eq('emailLinkId', inboxId),
      clause.or(
        clause.eq('emailSenderAddress', address),
        clause.eq('emailRecipientAddress', address),
        clause.eq('emailCcAddress', address),
        clause.eq('emailBccAddress', address)
      )
    );
  }

  const base = compileClause(confine({ ef: clause.and(...expressions) }));
  const refinements = compileFacets(
    admittedIds ? { ...context.facets, read: [] } : context.facets,
    EMAIL_FACETS,
    context.facetContext
  );
  const favoritesOnly = context.savedView
    ? context.savedView.conditions.starred
    : context.tab === 'favorites';
  const body: SoupAstBody = {
    ...mergeAst(base, refinements),
    emailView: context.savedView ? 'all' : emailViewForTab(context.tab),
    ...(favoritesOnly ? { favorites_only: true } : {}),
  };

  // Newest activity first: `updated_at` is the thread's latest message time.
  return {
    // Address, domain, and subject conditions, as aliases do, use GraphQL.
    ...(context.aliasFilter || context.savedView
      ? { transport: 'graphql' as const }
      : {}),
    params: {
      expand: true,
      limit: 100,
      sort_method: 'updated_at',
      sort_direction: 'desc',
    },
    body,
  };
}
