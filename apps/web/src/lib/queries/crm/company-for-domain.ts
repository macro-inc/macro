import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import { searchClient } from '@service-search/client';
import type { EntityFilters } from '@service-search/generated/models/entityFilters';
import type { UnifiedSearchResponseItem } from '@service-search/generated/models/unifiedSearchResponseItem';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { crmKeys } from './keys';

/** The `company` arm of the unified-search result union. */
type CompanySearchHit = Extract<UnifiedSearchResponseItem, { type: 'company' }>;

/**
 * Unified search scoped to CRM companies only. Every other source is
 * switched off with the NIL-UUID sentinel in its primary id field — the
 * same mechanism the soup views use (see `SearchEntityFilters::from`
 * server-side, which reads `call_filters.channel_ids` rather than
 * `call_ids` for call records).
 */
const CRM_ONLY_FILTERS: EntityFilters = {
  document_filters: { document_ids: [NIL_UUID] },
  chat_filters: { chat_ids: [NIL_UUID] },
  email_filters: { email_thread_ids: [NIL_UUID] },
  channel_filters: { channel_ids: [NIL_UUID] },
  channel_thread_filters: { thread_ids: [NIL_UUID] },
  project_filters: { project_ids: [NIL_UUID] },
  call_filters: { channel_ids: [NIL_UUID] },
  calendar_event_filters: { calendar_event_ids: [NIL_UUID] },
  foreign_entity_filters: { foreign_entity_ids: [NIL_UUID] },
  reminder_filters: { ids: [NIL_UUID] },
  // Visible companies only; the hidden set is admin-gated server-side.
  crm_company_filters: { hidden: false },
};

/** The search service rejects queries shorter than this. */
const MIN_SEARCH_LENGTH = 3;

/**
 * Company domains change rarely, and the panel re-resolves the same handful
 * of domains on every thread/event switch — a generous stale time keeps that
 * to one request per domain per session.
 */
const DOMAIN_LOOKUP_STALE_TIME = 5 * 60 * 1000;

/**
 * Enough headroom that an exact-domain company isn't pushed off the page by
 * substring matches (`acme.com` also matches `notacme.com`, `acme.com.br`, …)
 * without paying for a large response.
 */
const DOMAIN_LOOKUP_PAGE_SIZE = 25;

/**
 * Resolves an email domain to the id of the caller's team CRM company that
 * owns it, or `null` when the team tracks no company for that domain.
 *
 * There is no domain lookup endpoint on the CRM service, so this rides the
 * unified-search CRM source, whose match runs over `crm_domains.domain` as
 * well as the company name. That match is a case-insensitive *substring*, so
 * the hit is only accepted when one of the company's domains equals the
 * requested one exactly — a search for `acme.com` must never resolve to
 * `notacme.com`.
 *
 * Pair with {@link useCompanyQuery} to hydrate the company and its contacts.
 */
export function useCrmCompanyIdForDomainQuery(
  domain: Accessor<string | undefined>
) {
  return useQuery(() => {
    const target = domain()?.trim().toLowerCase();
    return {
      queryKey: crmKeys.companyForDomain(target ?? '').queryKey,
      queryFn: async () => {
        if (!target) return null;
        const response = await throwOnErr(() =>
          searchClient.search({
            params: { page_size: DOMAIN_LOOKUP_PAGE_SIZE },
            request: {
              query: target,
              match_type: 'partial',
              // CRM has no content index; it only participates under
              // name / name_content searches.
              search_on: 'name',
              include_crm: true,
              filters: CRM_ONLY_FILTERS,
            },
          })
        );

        const match = response.results.find(
          (result): result is CompanySearchHit =>
            result.type === 'company' &&
            result.domains.some(
              (entry) => entry.domain.trim().toLowerCase() === target
            )
        );
        return match?.id ?? null;
      },
      staleTime: DOMAIN_LOOKUP_STALE_TIME,
      enabled:
        ENABLE_SEARCH_SERVICE && !!target && target.length >= MIN_SEARCH_LENGTH,
    };
  });
}
