import type { ResultError } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { soupKeys } from '@queries/soup/keys';
import {
  CRM_MERGE_ERROR_CODES,
  type CrmMergeError,
} from '@service-storage/client';
import { invalidateCachedCrmContacts } from '@service-storage/crm-contacts';
import {
  forgetMergedCrmRecords,
  type MergedCrmRecords,
} from '@service-storage/crm-record-merge';
import type { QueryClient } from '@tanstack/solid-query';
import type { MergeCommands, MergeRefusal } from '../core/merge';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';

function refusalOf(errors: ResultError<string>[]): MergeRefusal {
  const first = errors[0] as Partial<CrmMergeError> | undefined;
  return {
    // Without a merge code the server's answer was lost or never came: a
    // commit may have gone through, and only its request key can tell.
    code:
      first?.code && CRM_MERGE_ERROR_CODES.includes(first.code)
        ? first.code
        : 'merge_unconfirmed',
    blocked: first?.blocked ?? null,
    currentId: first?.currentId ?? null,
  };
}

/**
 * Everything a merge moved is read again: CRM lists, records and pipelines,
 * Soup lists, and contacts' company summaries. The merged records' cached
 * copies go, so their chips read the record that stays, and so do their
 * unopened reads: kept, the next open would show a merged record as it was,
 * under its old id, until the read went stale. An open read refetches and
 * moves to the record that stays.
 */
export async function refreshAfterMerge(
  client: QueryClient,
  merged: MergedCrmRecords
) {
  const ids = (list: readonly string[]) => [
    ...new Set(list.flatMap((id) => [id, id.toLowerCase()])),
  ];
  const companies = ids(merged.companies);
  const contacts = ids(merged.contacts);
  for (const id of companies) {
    client.removeQueries({
      queryKey: crmKeys.company(id).queryKey,
      type: 'inactive',
    });
    client.removeQueries({
      queryKey: crmKeys.companyContacts(id).queryKey,
      type: 'inactive',
    });
  }
  for (const id of contacts) {
    client.removeQueries({
      queryKey: crmKeys.contact(id).queryKey,
      type: 'inactive',
    });
  }
  await forgetMergedCrmRecords({
    companies: merged.companies.map((id) => id.toLowerCase()),
    contacts: merged.contacts.map((id) => id.toLowerCase()),
  });
  await invalidateCachedCrmContacts();
  await Promise.all([
    client.invalidateQueries({ queryKey: crmKeys._def }),
    client.invalidateQueries({ queryKey: soupKeys._def }),
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
          refreshAfterMerge(deps.client, {
            companies: result.value.mergedIds,
            contacts: [],
          })
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
