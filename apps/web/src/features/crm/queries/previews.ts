import type { PreviewItem } from '@queries/preview/types';
import type { storageServiceClient } from '@service-storage/client';
import type { CrmPreviews } from '@service-storage/generated/schemas/crmPreviews';

/**
 * The hyphenated form the server reads a record id in. Any 128 bits will do,
 * as for Postgres's `uuid`: a stored id need not carry an RFC 9562 version
 * or variant, so `uuid`'s `validate` would refuse ids that name records.
 */
const RECORD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Titles CRM company and contact chips with one `POST /crm/previews` per
 * preview batch. The backend answers each record as its own read would, so
 * one it leaves out is one the viewer can't open: wrong team, hidden from a
 * member, or gone. That previews as "No Access", as the failed read did;
 * "Deleted" would be misleading since we can't tell which. An id not in
 * that form names no record, so it previews the same way without being sent:
 * the request would refuse it, and every chip in the batch with it. The
 * response spells ids in lowercase.
 */
export async function fetchCrmRecordPreviews(
  previewRecords: typeof storageServiceClient.previewCrmRecords,
  companyIds: string[],
  contactIds: string[]
): Promise<PreviewItem[]> {
  const request = {
    companyIds: companyIds.filter((id) => RECORD_ID.test(id)),
    contactIds: contactIds.filter((id) => RECORD_ID.test(id)),
  };
  const result =
    request.companyIds.length + request.contactIds.length > 0
      ? await previewRecords(request)
      : undefined;
  // A failed batch reads as no access, as each failed read did.
  const previews: CrmPreviews = result?.isOk()
    ? result.value
    : { companies: [], contacts: [] };

  const companies = new Map(
    previews.companies.map((company) => [company.id, company])
  );
  const contacts = new Map(
    previews.contacts.map((contact) => [contact.id, contact])
  );

  const companyPreviews = companyIds.map((id): PreviewItem => {
    const base = { id, type: 'crm_company', loading: false } as const;
    const company = companies.get(id.toLowerCase());
    if (!company) return { ...base, access: 'no_access' };

    const name = company.name ?? company.primaryDomain ?? 'Unknown Company';
    return {
      ...base,
      access: 'access',
      rawName: name,
      name,
      updatedAt: company.updatedAt,
    };
  });

  const contactPreviews = contactIds.map((id): PreviewItem => {
    const base = { id, type: 'crm_contact', loading: false } as const;
    const contact = contacts.get(id.toLowerCase());
    if (!contact) return { ...base, access: 'no_access' };

    const name = contact.name?.trim() || contact.email || '';
    return {
      ...base,
      access: 'access',
      rawName: name,
      name,
      updatedAt: contact.updatedAt,
    };
  });

  return [...companyPreviews, ...contactPreviews];
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
