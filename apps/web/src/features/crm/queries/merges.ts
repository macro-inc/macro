import type { ResultError } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
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
    review({ survivorId, sourceIds }) {
      return Telemetry.span('crm.merge.review', async (span) => {
        span.setAttr('crm.record_id', survivorId);
        span.setAttr('crm.merge.source_count', sourceIds.length);
        const result = await deps.storage.previewCrmMerge({
          recordType: 'company',
          survivorId,
          sourceIds,
        });
        if (result.isErr()) {
          const refusal = refusalOf(result.error);
          span.setAttr('crm.merge.refusal', refusal.code);
          return { ok: false, refusal };
        }
        span.setAttr('crm.merge.blocked', result.value.blocked?.kind ?? 'none');
        span.setAttr('crm.merge.conflict_count', result.value.conflicts.length);
        return { ok: true, value: result.value };
      });
    },
    commit(input) {
      return Telemetry.span('crm.merge.commit', async (span) => {
        span.setAttr('crm.record_id', input.survivorId);
        span.setAttr('crm.merge.source_count', input.sourceIds.length);
        span.setAttr('crm.merge.sharing_rules', input.sharingRules);
        const result = await span.span('crm.merge.commit.save', async () =>
          deps.storage.commitCrmMerge({ recordType: 'company', ...input })
        );
        if (result.isErr()) {
          const refusal = refusalOf(result.error);
          span.setAttr('crm.merge.refusal', refusal.code);
          return { ok: false, refusal };
        }
        span.setAttr('crm.merge.id', result.value.mergeId);
        await span.span('crm.merge.commit.refresh', () =>
          refreshAfterMerge(deps, result.value.mergedIds)
        );
        return {
          ok: true,
          value: {
            survivorId: result.value.survivorId,
            mergedIds: result.value.mergedIds,
          },
        };
      });
    },
  };
}
