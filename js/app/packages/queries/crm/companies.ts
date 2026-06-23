import { NIL_UUID } from '@app/component/next-soup/filters/filter-store';
import { throwOnErr } from '@core/util/result';
import type { CrmCompanyEntity } from '@entity';
import { storageServiceClient } from '@service-storage/client';
import type { CrmCompanyResponse } from '@service-storage/generated/schemas/crmCompanyResponse';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { type QueryKey, useMutation, useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { queryClient } from '../client';
import { soupKeys } from '../soup/keys';
import { crmKeys } from './keys';

const COMPANY_STALE_TIME = 60 * 1000;

/** A contact row as embedded in the company response. */
export type CompanyContact = CrmContactResponse;

/**
 * Fetches a single CRM company by id via `GET /crm/companies/{id}`.
 * The endpoint is role-aware via [`CrmCompanyAccessLevelExtractor`]:
 * non-admin viewers 404 on hidden rows, admin/owner reach hidden rows
 * for unhide UI. Contacts arrive embedded in the response so the
 * company panel hydrates in a single round trip.
 *
 * Disabled until a non-NIL companyId is available so callers can pass
 * a sentinel placeholder before their own data loads without firing a
 * doomed 404.
 */
export function useCompanyQuery(companyId: Accessor<string>) {
  const query = useQuery(() => {
    const id = companyId();
    return {
      queryKey: crmKeys.company(id).queryKey,
      queryFn: () => {
        if (!id) {
          throw new Error('company id is required to fetch company');
        }
        return throwOnErr(() =>
          storageServiceClient.getCompany({ companyId: id })
        );
      },
      staleTime: COMPANY_STALE_TIME,
      enabled: !!companyId() && companyId() !== NIL_UUID,
    };
  });

  const company = createMemo<CrmCompanyEntity | undefined>(() => {
    const data = query.data;
    if (!data) return undefined;
    return responseToEntity(data);
  });

  const contacts = createMemo<CompanyContact[]>(
    () => query.data?.contacts ?? []
  );

  return { query, company, contacts };
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
// (packages/companies/Company): the Team view's `ecd` domain widener and the
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
function wipeCompanyEmailCache(companyId: string): void {
  const company = queryClient.getQueryData<CrmCompanyResponse>(
    crmKeys.company(companyId).queryKey
  );
  const domains = company?.domains.map((d) => d.domain) ?? [];
  if (domains.length === 0) return;

  queryClient.removeQueries({
    queryKey: soupKeys.astItems._def,
    predicate: (query) => isCompanyEmailQueryKey(query.queryKey, domains),
  });
}

/**
 * Toggles `crm_companies.hidden` via `PUT /crm/companies/{id}/hidden`. Hiding
 * also disables `email_sync` and soft-hides the company's contacts; un-hide
 * restores contact visibility (contact rows and sources survive the cycle).
 * Invalidates soup (the company drops out of / returns to the listings) and the
 * company detail query so an open panel reflects the new hidden/email-sync state.
 */
export function useSetCompanyHiddenMutation() {
  return useMutation(() => ({
    mutationFn: ({
      companyId,
      hidden,
    }: {
      companyId: string;
      hidden: boolean;
    }) =>
      throwOnErr(() =>
        storageServiceClient.setCompanyHidden({ companyId, hidden })
      ),
    onSuccess: (_data, { companyId }) => {
      wipeCompanyEmailCache(companyId);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: soupKeys._def }),
        queryClient.invalidateQueries({
          queryKey: crmKeys.company(companyId).queryKey,
        }),
      ]);
    },
  }));
}

/**
 * Toggles `crm_companies.email_sync` via `PUT /crm/companies/{id}/email-sync`.
 * Purely a read-side visibility gate controlling whether the team can see each
 * other's emails with this company — existing CRM data is never destroyed and
 * re-enabling needs no backfill.
 */
export function useSetEmailSyncMutation() {
  return useMutation(() => ({
    mutationFn: ({
      companyId,
      emailSync,
    }: {
      companyId: string;
      emailSync: boolean;
    }) =>
      throwOnErr(() =>
        storageServiceClient.setEmailSync({ companyId, emailSync })
      ),
    // Wipe the cached email threads first so disabling sync can't leave stale
    // rows on screen, then return the invalidation promise so the mutation stays
    // pending until the refetches resolve — the company entity, empty-state
    // message, and emails list flip in one beat. Soup carries the team-wide
    // email visibility change; the company detail query backs the panel's
    // `emailSync` empty-state text.
    onSuccess: (_data, { companyId }) => {
      wipeCompanyEmailCache(companyId);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: soupKeys._def }),
        queryClient.invalidateQueries({
          queryKey: crmKeys.company(companyId).queryKey,
        }),
      ]);
    },
  }));
}
