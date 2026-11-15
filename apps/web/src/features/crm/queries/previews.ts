import type { ResultError } from '@core/util/result';
import type { PreviewItem } from '@queries/preview/types';
import type { storageServiceClient } from '@service-storage/client';
import type { CrmCompanyPreview } from '@service-storage/generated/schemas/crmCompanyPreview';
import type { CrmContactPreview } from '@service-storage/generated/schemas/crmContactPreview';
import type { CrmPreviewsRequest } from '@service-storage/generated/schemas/crmPreviewsRequest';

/**
 * The most ids of one kind `POST /crm/previews` takes; the server refuses a
 * request with more (`crm::domain::previews::MAX_PREVIEW_IDS`).
 */
export const MAX_PREVIEW_IDS = 100;

const HYPHENATED =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIMPLE = /^[0-9a-f]{32}$/i;
const URN_PREFIX = 'urn:uuid:';

/** The hyphenated part of a braced or `urn:uuid:` id, or the id itself. */
function unwrapped(id: string): string {
  if (id.startsWith(URN_PREFIX)) return id.slice(URN_PREFIX.length);
  if (id.startsWith('{') && id.endsWith('}')) return id.slice(1, -1);
  return id;
}

/**
 * A record id as the server spells it (lowercase, hyphenated), or undefined
 * for one it would refuse. The server parses ids as Rust's `Uuid::parse_str`
 * does: hyphenated, 32 hex digits, braced (`{…}`) or `urn:uuid:…`, in any
 * case except the lowercase prefix. Any 128 bits will do, as for Postgres's
 * `uuid`: a stored id need not carry an RFC 9562 version or variant, so
 * `uuid`'s `validate` would refuse ids that name records.
 */
export function canonicalRecordId(id: string): string | undefined {
  if (SIMPLE.test(id)) {
    const hex = id.toLowerCase();
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-');
  }
  const inner = unwrapped(id);
  return HYPHENATED.test(inner) ? inner.toLowerCase() : undefined;
}

/**
 * One preview batch's company and contact chips. A record whose request
 * failed has no preview yet: it is in `failed`, with the request's errors,
 * so the chip can retry instead of caching a failure as "No Access".
 */
export type CrmRecordPreviews = {
  previews: PreviewItem[];
  failed: Map<string, ResultError<string>[]>;
};

/** The canonical ids of `ids` that the server would read, each once. */
function requestIds(ids: string[]): string[] {
  const canonical = ids.map(canonicalRecordId);
  return [...new Set(canonical.filter((id) => id !== undefined))];
}

function chunked(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += MAX_PREVIEW_IDS) {
    chunks.push(ids.slice(start, start + MAX_PREVIEW_IDS));
  }
  return chunks;
}

/** Requests of at most `MAX_PREVIEW_IDS` ids of each kind. */
function previewRequests(
  companyIds: string[],
  contactIds: string[]
): CrmPreviewsRequest[] {
  const companies = chunked(companyIds);
  const contacts = chunked(contactIds);
  return Array.from(
    { length: Math.max(companies.length, contacts.length) },
    (_, index) => ({
      companyIds: companies[index] ?? [],
      contactIds: contacts[index] ?? [],
    })
  );
}

type Answers = {
  companies: Map<string, CrmCompanyPreview>;
  contacts: Map<string, CrmContactPreview>;
  failedCompanies: Map<string, ResultError<string>[]>;
  failedContacts: Map<string, ResultError<string>[]>;
};

/** Each request's records by id, and the ids of the requests that failed. */
async function sendRequests(
  previewRecords: typeof storageServiceClient.previewCrmRecords,
  requests: CrmPreviewsRequest[]
): Promise<Answers> {
  const results = await Promise.all(
    requests.map(async (request) => ({
      request,
      result: await previewRecords(request),
    }))
  );
  const answers: Answers = {
    companies: new Map(),
    contacts: new Map(),
    failedCompanies: new Map(),
    failedContacts: new Map(),
  };
  for (const { request, result } of results) {
    if (result.isErr()) {
      for (const id of request.companyIds ?? [])
        answers.failedCompanies.set(id, result.error);
      for (const id of request.contactIds ?? [])
        answers.failedContacts.set(id, result.error);
      continue;
    }
    for (const company of result.value.companies)
      answers.companies.set(company.id, company);
    for (const contact of result.value.contacts)
      answers.contacts.set(contact.id, contact);
  }
  return answers;
}

function lookup<T>(
  byId: Map<string, T>,
  canonical: string | undefined
): T | undefined {
  return canonical === undefined ? undefined : byId.get(canonical);
}

/**
 * Titles CRM company and contact chips with one `POST /crm/previews` per
 * preview batch, or one per `MAX_PREVIEW_IDS` ids of a kind. The backend
 * answers each record as its own read would, so one it leaves out is one the
 * viewer can't open: wrong team, hidden from a member, or gone. That previews
 * as "No Access", as the failed read did; "Deleted" would be misleading since
 * we can't tell which. An id the server can't parse names no record, so it
 * previews the same way without being sent: the request would refuse it, and
 * every chip in the request with it. The response spells ids in lowercase.
 */
export async function fetchCrmRecordPreviews(
  previewRecords: typeof storageServiceClient.previewCrmRecords,
  companyIds: string[],
  contactIds: string[]
): Promise<CrmRecordPreviews> {
  const answers = await sendRequests(
    previewRecords,
    previewRequests(requestIds(companyIds), requestIds(contactIds))
  );
  const previews: PreviewItem[] = [];
  const failed = new Map<string, ResultError<string>[]>();

  for (const id of companyIds) {
    const base = { id, type: 'crm_company', loading: false } as const;
    const canonical = canonicalRecordId(id);
    const errors = lookup(answers.failedCompanies, canonical);
    if (errors) {
      failed.set(id, errors);
      continue;
    }
    const company = lookup(answers.companies, canonical);
    if (!company) {
      previews.push({ ...base, access: 'no_access' });
      continue;
    }
    const name = company.name ?? company.primaryDomain ?? 'Unknown Company';
    previews.push({
      ...base,
      access: 'access',
      rawName: name,
      name,
      updatedAt: company.updatedAt,
    });
  }

  for (const id of contactIds) {
    const base = { id, type: 'crm_contact', loading: false } as const;
    const canonical = canonicalRecordId(id);
    const errors = lookup(answers.failedContacts, canonical);
    if (errors) {
      failed.set(id, errors);
      continue;
    }
    const contact = lookup(answers.contacts, canonical);
    if (!contact) {
      previews.push({ ...base, access: 'no_access' });
      continue;
    }
    const name = contact.name?.trim() || contact.email || '';
    previews.push({
      ...base,
      access: 'access',
      rawName: name,
      name,
      updatedAt: contact.updatedAt,
    });
  }

  return { previews, failed };
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
