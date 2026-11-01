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

/** A pipeline previews from its own read; one gone or trashed reads as deleted. */
export async function fetchCrmPipelinePreviews(
  getPipeline: typeof storageServiceClient.getCrmPipeline,
  pipelineIds: string[]
): Promise<PreviewItem[]> {
  return await Promise.all(
    pipelineIds.map(async (id): Promise<PreviewItem> => {
      const base = { id, type: 'crm_pipeline', loading: false } as const;
      const result = await getPipeline(id);
      if (result.isErr())
        return {
          ...base,
          access: result.error.some(
            (error) => error.code === 'NOT_FOUND' || error.code === 'GONE'
          )
            ? 'does_not_exist'
            : 'no_access',
        };
      const pipeline = result.value;
      if (pipeline.trashedAt) return { ...base, access: 'does_not_exist' };
      return {
        ...base,
        access: 'access',
        rawName: pipeline.name,
        name: pipeline.name,
        owner: pipeline.userId,
      };
    })
  );
}

/** Contact titles use the same role-aware REST boundary as contact details. */
export async function fetchCrmContactPreviews(
  getContact: typeof storageServiceClient.getContact,
  contactIds: string[]
): Promise<PreviewItem[]> {
  return await Promise.all(
    contactIds.map(async (id) => {
      const base = {
        id,
        type: 'crm_contact' as const,
        loading: false as const,
      };
      const result = await getContact({ contactId: id });
      if (result.isErr()) return { ...base, access: 'no_access' as const };
      const contact = result.value;
      const name = contact.name?.trim() || contact.email;
      return {
        ...base,
        access: 'access' as const,
        name,
        rawName: name,
        updatedAt: contact.updatedAt,
      };
    })
  );
}
