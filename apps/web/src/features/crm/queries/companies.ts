import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import { analytics } from '@app/lib/analytics';
import { captureQueryAuthorization } from '@app/lib/urql-solid/authorization';
import { ThrownResultError, throwOnErr } from '@core/util/result';
import type { CrmCompanyEntity } from '@entity';
import { Telemetry } from '@macro-inc/observability';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { soupKeys } from '@queries/soup/keys';
import { invalidateCachedCrmContacts } from '@service-storage/crm-contacts';
import { prepareCrmVisibilityWrite } from '@service-storage/crm-visibility';
import type { CrmCompanyResponse } from '@service-storage/generated/schemas/crmCompanyResponse';
import type { CrmContactDetailResponse } from '@service-storage/generated/schemas/crmContactDetailResponse';
import {
  type Query,
  type QueryClient,
  type QueryKey,
  queryOptions,
  useMutation,
  useQuery,
} from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import type { CompanyImporter } from '../context/crm-sources';
import type { CompanyDomainChange } from '../core/company';
import { contactCompanySummary } from '../core/contact';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';
import { listCanIncludeCrm } from './list-refresh';
import {
  updateVisibilityDetails,
  visibilityDetailsFilter,
  visibilityQueryFilter,
} from './visibility-refresh';

const COMPANY_STALE_TIME = 60 * 1000;

function companyQueryOptions(deps: CrmRecordDependencies, companyId: string) {
  return queryOptions({
    queryKey: crmKeys.company(companyId).queryKey,
    queryFn: () => {
      if (!companyId) {
        throw new Error('company id is required to fetch company');
      }
      return throwOnErr(() =>
        deps.storage.getCompany({ companyId, includeContacts: false })
      );
    },
    staleTime: COMPANY_STALE_TIME,
    enabled: !!companyId && companyId !== NIL_UUID,
  });
}

/**
 * Fetches a single CRM company by id via `GET /crm/companies/{id}`.
 * The endpoint is role-aware via [`CrmCompanyAccessLevelExtractor`]:
 * non-admin viewers 404 on hidden rows, admin/owner reach hidden rows
 * for unhide UI. It asks for no contacts: the Team list pages them through
 * `useCompanyContactsQuery`.
 *
 * Disabled until a non-NIL companyId is available so callers can pass
 * a sentinel placeholder before their own data loads without firing a
 * doomed 404.
 */
export function useCompanyQuery(
  deps: CrmRecordDependencies,
  companyId: Accessor<string>
) {
  const query = useQuery(
    () => companyQueryOptions(deps, companyId()),
    () => deps.client
  );

  const company = createMemo<CrmCompanyEntity | undefined>(() => {
    const data = query.isSuccess ? query.data : undefined;
    if (!data) return undefined;
    return responseToEntity(data);
  });

  return { query, company };
}

function responseToEntity(response: CrmCompanyResponse): CrmCompanyEntity {
  return {
    type: 'crm_company',
    id: response.id,
    // CrmCompanyEntity.name is a required string; the wire schema's
    // primary-directory `name` is nullable. Fall back to the primary
    // domain (or empty) so consumers don't have to special-case.
    name: response.name ?? response.domains[0]?.domain ?? '',
    // Companies are team-owned, not user-owned; the team id fills the
    // ownerId slot (matching the soup/search mappers in transform-utils).
    ownerId: response.teamId,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    teamId: response.teamId,
    description: response.description ?? undefined,
    emailSync: response.emailSync,
    hidden: response.hidden,
    domains: response.domains.map((d) => ({
      id: d.id,
      companyId: d.companyId,
      domain: d.domain,
      createdAt: d.createdAt,
    })),
  };
}

// Matches the company-email soup queries built by `useCompanyEmailsQuery`
// (features/crm/queries/company-emails.ts): the Team view's `ecd` domain widener and the
// Me view's `ef` tree, both keyed on the company's email domains. astItems key
// shape is ['soup', 'astItems', params, body, groupBy], so the body is at [3].
function isCompanyEmailQueryKey(
  queryKey: QueryKey,
  domains: string[]
): boolean {
  const body = queryKey[3] as { ecd?: unknown; ef?: unknown } | undefined;
  if (!body) return false;
  if (
    Array.isArray(body.ecd) &&
    body.ecd.some((d) => domains.includes(d as string))
  ) {
    return true;
  }
  if (body.ef != null) {
    const serialized = JSON.stringify(body.ef);
    // Quote-wrap each domain so "example.com" can't match "sub.example.com".
    return domains.some((d) => serialized.includes(JSON.stringify(d)));
  }
  return false;
}

// Wipe (not just invalidate) the company's cached email threads. Invalidate
// keeps serving the stale rows — and won't refetch once the panel navigates
// away on hide — so toggling hidden/email-sync left old emails on screen until
// a full refresh. Removing forces a cold reload, the same as that refresh did.
function wipeCompanyEmailCache(
  deps: CrmRecordDependencies,
  companyId: string
): void {
  const company = deps.client.getQueryData<CrmCompanyResponse>(
    crmKeys.company(companyId).queryKey
  );
  const domains = company?.domains.map((d) => d.domain) ?? [];
  if (domains.length === 0) return;

  deps.client.removeQueries({
    queryKey: soupKeys.astItems._def,
    predicate: (query) => isCompanyEmailQueryKey(query.queryKey, domains),
  });
}

/**
 * Manually creates a CRM company via `POST /crm/companies` (a team-scoped
 * display name + optional domain). Seeds the company detail cache from the
 * response and invalidates soup so the new company appears in the
 * Customers listings. Server-side failures worth surfacing: 409 when the
 * team already tracks the domain, 403 without team membership,
 * 400 on a malformed/generic-provider domain.
 */
export function useCreateCompanyMutation(deps: CrmRecordDependencies) {
  return useMutation(
    () => ({
      onMutate: () => captureQueryAuthorization(),
      mutationFn: ({ name, domain }: { name: string; domain?: string }) =>
        Telemetry.span('crm.company.create', async (span) => {
          span.setAttr('crm.company.has_domain', !!domain);
          const company = await throwOnErr(() =>
            deps.storage.createCompany({ name, domain })
          );
          span.setAttr('crm.company.id', company.id);
          return company;
        }),
      onSuccess: (data, _variables, canCache) => {
        analytics.track('crm_company_created', { companyId: data.id });
        if (!canCache?.()) return;
        deps.client.setQueryData(crmKeys.company(data.id).queryKey, data);
        return deps.client.invalidateQueries({ queryKey: soupKeys._def });
      },
    }),
    () => deps.client
  );
}

/**
 * Creates companies for an import without `useCreateCompanyMutation`'s
 * per-company soup refresh, which would refetch every listing once per row.
 * A domain the team already tracks (409) is reported as existing.
 */
export function createCompanyImporter(
  deps: CrmRecordDependencies
): CompanyImporter {
  return {
    async create(input) {
      const canCache = captureQueryAuthorization();
      const created = await deps.storage.createCompany(input);
      if (created.isOk()) {
        if (canCache())
          deps.client.setQueryData(
            crmKeys.company(created.value.id).queryKey,
            created.value
          );
        return 'created';
      }
      if (created.error.some((error) => error.code === 'CONFLICT'))
        return 'exists';
      throw new ThrownResultError(created.error);
    },
    refresh: () => deps.client.invalidateQueries({ queryKey: soupKeys._def }),
  };
}

/**
 * Manually creates a contact via `POST /crm/companies/{id}/contacts`, or
 * `POST /crm/contacts` for a contact without a company (a display name +
 * optional email). Invalidates the company's Team list and soup so contact
 * listings refresh. Server-side failures worth surfacing: 409 when the email
 * is already tracked, 404 when the company isn't visible to the caller, 403
 * without team membership.
 */
export function useCreateContactMutation(deps: CrmRecordDependencies) {
  return useMutation(
    () => ({
      onMutate: () => captureQueryAuthorization(),
      mutationFn: ({
        companyId,
        name,
        email,
      }: {
        companyId?: string;
        name: string;
        email?: string;
      }) =>
        Telemetry.span('crm.contact.create', async (span) => {
          if (companyId) span.setAttr('crm.company.id', companyId);
          const contact = await throwOnErr(() =>
            companyId
              ? deps.storage.createContact({ companyId, name, email })
              : deps.storage.createTeamContact({ name, email })
          );
          span.setAttr('crm.contact.id', contact.id);
          return contact;
        }),
      onSuccess: (contact, { companyId }, canCache) => {
        analytics.track('crm_contact_created', {
          companyId,
          contactId: contact.id,
        });
        if (!canCache?.()) return;
        return Promise.all([
          companyId &&
            deps.client.invalidateQueries({
              queryKey: crmKeys.companyContacts(companyId).queryKey,
            }),
          deps.client.invalidateQueries({ queryKey: soupKeys._def }),
        ]);
      },
    }),
    () => deps.client
  );
}

/**
 * Renames a company via `PUT /crm/companies/{id}/name`. The name is a
 * team-scoped override (`crm_companies.custom_name`) that read paths resolve
 * over the global directory name — the shared directory is never touched.
 * Optimistically updates the company detail and the summaries of loaded
 * contact details (with rollback on error) so the name flips immediately,
 * then invalidates them plus soup so the Customers listings pick up the new
 * name.
 */
export function useSetCompanyNameMutation(deps: CrmRecordDependencies) {
  return useMutation(
    () => ({
      mutationFn: ({ companyId, name }: { companyId: string; name: string }) =>
        throwOnErr(() => deps.storage.setCompanyName({ companyId, name })),
      onMutate: async ({ companyId, name }) => {
        const canCache = captureQueryAuthorization();
        const queryKey = crmKeys.company(companyId).queryKey;
        const details = contactDetailsOfCompanyFilter(companyId);
        await Promise.all([
          deps.client.cancelQueries({ queryKey }),
          deps.client.cancelQueries(details),
        ]);
        if (!canCache()) return;
        const previous = deps.client.getQueryData<CrmCompanyResponse>(queryKey);
        if (previous) {
          deps.client.setQueryData<CrmCompanyResponse>(queryKey, {
            ...previous,
            name,
          });
        }
        const previousDetails =
          deps.client.getQueriesData<CrmContactDetailResponse>(details);
        for (const [key, detail] of previousDetails) {
          if (!detail?.company) continue;
          deps.client.setQueryData<CrmContactDetailResponse>(key, {
            ...detail,
            company: { ...detail.company, name },
          });
        }
        return { previous, previousDetails, optimisticName: name, canCache };
      },
      // Roll back only if the cache still holds this mutation's optimistic
      // name — a stale failure must not clobber a newer rename's update.
      onError: (_err, { companyId }, context) => {
        if (!context?.canCache()) return;
        if (context.previous) {
          deps.client.setQueryData<CrmCompanyResponse>(
            crmKeys.company(companyId).queryKey,
            (current) =>
              current?.name === context.optimisticName
                ? context.previous
                : current
          );
        }
        for (const [key, detail] of context.previousDetails) {
          const name = detail?.company?.name;
          deps.client.setQueryData<CrmContactDetailResponse>(key, (current) =>
            current?.company?.id === companyId &&
            current.company.name === context.optimisticName
              ? { ...current, company: { ...current.company, name } }
              : current
          );
        }
      },
      onSuccess: (_data, { companyId }) =>
        refreshContactDetailsOfCompany(deps.client, companyId),
      onSettled: async (_data, _err, { companyId }) => {
        await invalidateCachedCrmContacts();
        return Promise.all([
          deps.client.invalidateQueries({
            queryKey: crmKeys.company(companyId).queryKey,
          }),
          deps.client.invalidateQueries({ queryKey: soupKeys._def }),
        ]);
      },
    }),
    () => deps.client
  );
}

/**
 * Adds or removes a company domain via `PUT`/`DELETE
 * /crm/companies/{id}/domains`. The server never changes the company's name
 * or primary domain, so the answer replaces only the domain list of the
 * cached company. Which of the company's contacts are on its domains changes
 * with it, so their details and the company's Team list refresh, and soup
 * refreshes the domains Customers listings show. Failures worth surfacing:
 * 409 when another company has the domain (its name in the error message),
 * 400 for a personal provider or the domain the company is named after, 403
 * for a member removing a domain from a company whose email sync is off.
 */
export function useEditCompanyDomainMutation(deps: CrmRecordDependencies) {
  return useMutation(
    () => ({
      // The header and Record details each edit through their own instance;
      // one edit at a time keeps a slower response from replacing a newer list.
      scope: { id: 'crm-company-domain-edits' },
      mutationFn: ({
        companyId,
        domain,
        change,
      }: {
        companyId: string;
        domain: string;
        change: CompanyDomainChange;
      }) => editCompanyDomain(deps, companyId, domain, change),
    }),
    () => deps.client
  );
}

async function editCompanyDomain(
  deps: CrmRecordDependencies,
  companyId: string,
  domain: string,
  change: CompanyDomainChange
): Promise<CrmCompanyResponse> {
  return Telemetry.span('crm.company_domain_edit', async (span) => {
    span.setAttr('crm.record_id', companyId);
    span.setAttr('crm.change', change);
    const canCache = captureQueryAuthorization();
    const write =
      change === 'add'
        ? deps.storage.addCompanyDomain
        : deps.storage.removeCompanyDomain;
    const company = await span.span('crm.company_domain_edit.save', () =>
      throwOnErr(() => write({ companyId, domain }))
    );
    if (!canCache()) return company;

    // A read already in flight would answer with the domains before the
    // write and replace these.
    await deps.client.cancelQueries({
      queryKey: crmKeys.company(companyId).queryKey,
    });
    if (!canCache()) return company;
    deps.client.setQueryData<CrmCompanyResponse>(
      crmKeys.company(companyId).queryKey,
      (current) => current && { ...current, domains: company.domains }
    );
    await span.span('crm.company_domain_edit.refresh', () =>
      Promise.all([
        refreshContactDetailsOfCompany(deps.client, companyId),
        deps.client.invalidateQueries({
          queryKey: crmKeys.companyContacts(companyId).queryKey,
        }),
        deps.client.invalidateQueries({ queryKey: soupKeys._def }),
      ])
    );
    return company;
  });
}

/** Loaded contact details whose summary is of `companyId`. */
function contactDetailsOfCompanyFilter(companyId: string) {
  return {
    queryKey: crmKeys.contact._def,
    predicate: (query: Query) =>
      contactCompanySummary(
        query.state.data as CrmContactDetailResponse | undefined
      )?.id === companyId,
  };
}

/**
 * Contact details carry their company's name, so a rename refreshes those of
 * the company's contacts, and any still loading, whose answer may predate the
 * rename. A loading read is cancelled first: invalidating it would only join
 * the read already in flight, whose answer then clears the invalidation.
 */
async function refreshContactDetailsOfCompany(
  client: QueryClient,
  companyId: string
): Promise<void> {
  const loading = new Set(
    client
      .getQueryCache()
      .findAll({ queryKey: crmKeys.contact._def, predicate: isFirstLoad })
      .map((query) => query.queryHash)
  );
  await client.cancelQueries({
    queryKey: crmKeys.contact._def,
    predicate: (query) => loading.has(query.queryHash),
  });
  await client.invalidateQueries({
    queryKey: crmKeys.contact._def,
    predicate: (query) =>
      loading.has(query.queryHash) ||
      contactOfCompany(query.state.data, companyId),
  });
}

function isFirstLoad(query: Query): boolean {
  return (
    query.state.data === undefined && query.state.fetchStatus === 'fetching'
  );
}

function contactOfCompany(data: unknown, companyId: string): boolean {
  return (
    !!data &&
    typeof data === 'object' &&
    'companyId' in data &&
    data.companyId === companyId
  );
}

/**
 * Toggles `crm_companies.hidden` via `PUT /crm/companies/{id}/hidden`. Hiding
 * also disables `email_sync` and soft-hides the company's contacts; un-hide
 * restores contact visibility (contact rows and sources survive the cycle).
 * Invalidates soup (the company drops out of / returns to the listings) and the
 * company detail query so an open panel reflects the new hidden/email-sync state.
 */
export function useSetCompanyHiddenMutation(deps: CrmRecordDependencies) {
  return useMutation(
    () => ({
      mutationFn: ({
        companyId,
        hidden,
      }: {
        companyId: string;
        hidden: boolean;
      }) =>
        Telemetry.span('crm.visibility_change', async (span) => {
          span.setAttr('crm.record_type', 'company');
          span.setAttr('crm.record_id', companyId);
          span.setAttr('crm.hidden', hidden);
          try {
            const cacheWrite = prepareCrmVisibilityWrite();
            // The write returns no affected contact IDs. A stale or empty roster
            // would leave cascaded contacts eligible in normalized search.
            const company = await throwOnErr(() =>
              deps.storage.getCompany({ companyId })
            );
            if (!cacheWrite.isCurrent()) throw new Error('Session changed');
            const result = await span.run(() =>
              throwOnErr(() =>
                deps.storage.setCompanyHidden({ companyId, hidden })
              )
            );
            if (!cacheWrite.isCurrent()) return result;
            await span.span(
              'crm.visibility_change.refresh',
              async (refresh) => {
                try {
                  const change = {
                    kind: 'company' as const,
                    id: companyId,
                    hidden,
                  };
                  await Promise.all([
                    cacheWrite.commit({
                      companyId,
                      contactIds: company.contacts.map((contact) => contact.id),
                      hidden,
                    }),
                    updateVisibilityDetails(
                      deps.client,
                      change,
                      cacheWrite.isCurrent
                    ),
                  ]);
                  if (!cacheWrite.isCurrent()) return;
                  wipeCompanyEmailCache(deps, companyId);
                  await Promise.all([
                    refreshActiveGraphqlSoupQueries({
                      where: listCanIncludeCrm,
                      unmaintainedOnly: true,
                    }),
                    deps.client.invalidateQueries({
                      predicate: visibilityQueryFilter(change),
                    }),
                    deps.client.invalidateQueries({
                      predicate: visibilityDetailsFilter(change),
                      // Confirmed flags are already patched; refresh on the next visit.
                      refetchType: 'none',
                    }),
                    deps.client.refetchQueries({
                      type: 'active',
                      predicate: (query) =>
                        query.state.data === undefined &&
                        visibilityDetailsFilter(change)(query),
                    }),
                  ]);
                } catch (error) {
                  refresh.error('Company visibility refresh failed');
                  Telemetry.error(error);
                }
              }
            );
            span.setAttr('crm.visibility.outcome', 'success');
            return result;
          } catch (error) {
            span.setAttr('crm.visibility.outcome', 'error');
            span.error('Company visibility update failed');
            throw error;
          }
        }),
    }),
    () => deps.client
  );
}

/**
 * Toggles `crm_companies.email_sync` via `PUT /crm/companies/{id}/email-sync`.
 * Blocks ingestion and CRM email visibility for the company's domains while
 * preserving its records. Re-enabling schedules a backfill for consenting
 * contributors.
 */
export function useSetEmailSyncMutation(deps: CrmRecordDependencies) {
  return useMutation(
    () => ({
      mutationFn: ({
        companyId,
        emailSync,
      }: {
        companyId: string;
        emailSync: boolean;
      }) =>
        throwOnErr(() => deps.storage.setEmailSync({ companyId, emailSync })),
      // Wipe the cached email threads first so disabling sync can't leave stale
      // rows on screen, then return the invalidation promise so the mutation stays
      // pending until the refetches resolve — the company entity, empty-state
      // message, and emails list flip in one beat. Soup carries the team-wide
      // email visibility change; the company detail query backs the panel's
      // `emailSync` empty-state text.
      onSuccess: (_data, { companyId }) => {
        wipeCompanyEmailCache(deps, companyId);
        return Promise.all([
          deps.client.invalidateQueries({ queryKey: soupKeys._def }),
          deps.client.invalidateQueries({
            queryKey: crmKeys.company(companyId).queryKey,
          }),
        ]);
      },
    }),
    () => deps.client
  );
}
