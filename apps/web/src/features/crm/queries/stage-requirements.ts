import { captureQueryAuthorization } from '@app/lib/urql-solid/authorization';
import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { useQuery } from '@tanstack/solid-query';
import type { StageRequirement } from '../core/stage-requirements';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';

function stageRequirementsOptions(
  storage: CrmRecordDependencies['storage'],
  pipelineId: string,
  poll: boolean
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
    // The pipeline page polls so an edit made elsewhere shows; a one-off reader
    // keeps its first answer, and the server's stage guard covers the rest.
    ...(poll
      ? { refetchInterval: 5000 }
      : {
          refetchInterval: false as const,
          staleTime: Number.POSITIVE_INFINITY,
        }),
  };
}

/** Pipeline policy is fetched separately from the host-independent table schema. */
export function useStageRequirements(
  deps: CrmRecordDependencies,
  pipelineId: string,
  { poll = true }: { poll?: boolean } = {}
) {
  const queryKey = crmKeys.stageRequirements(pipelineId).queryKey;
  const query = useQuery(
    () => stageRequirementsOptions(deps.storage, pipelineId, poll),
    () => deps.client
  );
  return {
    query,
    save: (rule: StageRequirement) =>
      Telemetry.span('crm.stage-requirements.save', async (span) => {
        const canCache = captureQueryAuthorization();
        span.setAttr('pipeline.id', pipelineId);
        await deps.client.cancelQueries({ queryKey });
        await throwOnErr(() =>
          deps.storage.setCrmPipelineStageRequirement(pipelineId, {
            stageColumnId: rule.columnId,
            stageId: rule.optionId,
            requiredColumnIds: rule.fields,
          })
        );
        if (!canCache()) return;
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
