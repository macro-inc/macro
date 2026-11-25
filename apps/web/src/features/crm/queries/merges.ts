import type { ResultError } from '@core/util/result';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { soupKeys } from '@queries/soup/keys';
import type { CrmMergeError } from '@service-storage/client';
import { invalidateCachedCrmContacts } from '@service-storage/crm-contacts';
import { forgetMergedCrmRecords } from '@service-storage/crm-record-merge';
import type { MergeCommands, MergeRefusal } from '../core/merge';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';

function refusalOf(errors: ResultError<string>[]): MergeRefusal {
  const first = errors[0] as Partial<CrmMergeError> | undefined;
  return {
    code: first?.code ?? 'unknown',
    blocked: first?.blocked ?? null,
    currentId: first?.currentId ?? null,
  };
}

/**
 * Everything a merge moved is read again: CRM lists, records and pipelines,
 * Soup lists, and contacts' company summaries. The merged companies' cached
 * records go, so their chips read the company that stays.
 */
async function refreshAfterMerge(
  deps: CrmRecordDependencies,
  mergedIds: string[]
) {
  await forgetMergedCrmRecords({
    companies: mergedIds.map((id) => id.toLowerCase()),
    contacts: [],
  });
  await invalidateCachedCrmContacts();
  await Promise.all([
    deps.client.invalidateQueries({ queryKey: crmKeys._def }),
    deps.client.invalidateQueries({ queryKey: soupKeys._def }),
  ]);
  await refreshActiveGraphqlSoupQueries();
}

/** Review and commit company merges through `POST /crm/merges`. */
export function createMergeCommands(
  deps: CrmRecordDependencies
): MergeCommands {
  return {
    async review({ survivorId, sourceIds }) {
      const result = await deps.storage.previewCrmMerge({
        recordType: 'company',
        survivorId,
        sourceIds,
      });
      return result.isOk()
        ? { ok: true, value: result.value }
        : { ok: false, refusal: refusalOf(result.error) };
    },
    async commit(input) {
      const result = await deps.storage.commitCrmMerge({
        recordType: 'company',
        ...input,
      });
      if (result.isErr())
        return { ok: false, refusal: refusalOf(result.error) };
      await refreshAfterMerge(deps, result.value.mergedIds);
      return {
        ok: true,
        value: {
          survivorId: result.value.survivorId,
          mergedIds: result.value.mergedIds,
        },
      };
    },
  };
}
