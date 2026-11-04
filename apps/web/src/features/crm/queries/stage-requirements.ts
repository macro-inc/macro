import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { useQuery } from '@tanstack/solid-query';
import type { StageRequirement } from '../core/stage-requirements';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';

function stageRequirementsOptions(
  storage: CrmRecordDependencies['storage'],
  pipelineId: string
) {
  return {
    queryKey: crmKeys.stageRequirements(pipelineId).queryKey,
    queryFn: async () =>
      (
        await throwOnErr(() =>
          storage.getCrmPipelineStageRequirements(pipelineId)
        )
      ).map(
        (rule): StageRequirement => ({
          columnId: rule.stageColumnId,
          optionId: rule.stageId,
          fields: rule.requiredColumnIds,
        })
      ),
    refetchInterval: 5000,
  };
}

/** Pipeline policy is fetched separately from the host-independent table schema. */
export function useStageRequirements(
  deps: CrmRecordDependencies,
  pipelineId: string
) {
  const queryKey = crmKeys.stageRequirements(pipelineId).queryKey;
  const query = useQuery(
    () => stageRequirementsOptions(deps.storage, pipelineId),
    () => deps.client
  );
  return {
    query,
    save: (rule: StageRequirement) =>
      Telemetry.span('crm.stage-requirements.save', async (span) => {
        span.setAttr('pipeline.id', pipelineId);
        await deps.client.cancelQueries({ queryKey });
        await throwOnErr(() =>
          deps.storage.setCrmPipelineStageRequirement(pipelineId, {
            stageColumnId: rule.columnId,
            stageId: rule.optionId,
            requiredColumnIds: rule.fields,
          })
        );
        // Update the committed rule immediately, even if the subsequent refresh fails.
        deps.client.setQueryData<StageRequirement[]>(queryKey, (current) => [
          ...(current ?? []).filter(
            (item) =>
              item.columnId !== rule.columnId || item.optionId !== rule.optionId
          ),
          ...(rule.fields.length ? [rule] : []),
        ]);
        await deps.client.invalidateQueries({ queryKey });
      }),
  };
}
