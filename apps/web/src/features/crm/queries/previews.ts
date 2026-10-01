import type { PreviewItem } from '@queries/preview/types';
import type { storageServiceClient } from '@service-storage/client';

/**
 * Fetches CRM company previews via `GET /crm/companies/{id}`. Mirrors the
 * email preview fetcher's shape — N parallel REST calls rather than a
 * batch endpoint, since the CRM REST surface is per-id today and
 * companies are a smaller cardinality than mentions in flight.
 *
 * The backend already gates hidden visibility by role (admin/owner sees
 * hidden, non-admin 404s), so the fetcher doesn't need to repeat that
 * logic.
 */
export async function fetchCrmCompanyPreviews(
  getCompany: typeof storageServiceClient.getCompany,
  companyIds: string[]
): Promise<PreviewItem[]> {
  return await Promise.all(
    companyIds.map(async (id) => {
      const base = { id, type: 'crm_company' as const };
      const result = await getCompany({ companyId: id });

      if (result.isErr()) {
        // The backend returns 404 for every unreachable reason (wrong
        // team, hidden+member, doesn't exist) — deliberate, so existence
        // can't be probed across teams. Maps to "No Access" for parity
        // with the email fetcher's per-id convention; "Deleted" would be
        // misleading since we can't actually tell.
        return {
          ...base,
          access: 'no_access' as const,
          loading: false as const,
        };
      }

      const company = result.value;
      const displayName =
        company.name ?? company.domains[0]?.domain ?? 'Unknown Company';

      return {
        ...base,
        access: 'access' as const,
        loading: false as const,
        rawName: displayName,
        name: displayName,
        updatedAt: company.updatedAt,
      };
    })
  );
}
