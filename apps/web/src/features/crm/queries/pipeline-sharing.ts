import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { SharePermissionV2 } from '@service-storage/generated/schemas/sharePermissionV2';
import type { Pipeline } from '../core/pipeline';
import { crmKeys } from './keys';

/** Adapt pipeline grants to the standard sharing dialog. */
export async function fetchPipelineSharePermissions(id: string) {
  const pipeline = await storageServiceClient.getCrmPipeline(id);
  if (pipeline.isErr()) return pipeline;
  return pipeline.map(
    (value): SharePermissionV2 => ({
      id,
      owner: value.userId,
      channelSharePermissions: [],
      linkShare: null,
      linkShareAccessLevel: null,
      teamShareAccessLevel: value.sharing === 'team' ? 'edit' : null,
    })
  );
}

export async function updatePipelineTeamShare(id: string, shared: boolean) {
  const sharing = shared ? 'team' : 'private';
  const result = await storageServiceClient.shareCrmPipeline(id, sharing);
  if (result.isOk()) {
    queryClient.setQueriesData<Pipeline[]>(
      { queryKey: crmKeys.pipelines._def },
      (before) =>
        before?.map((pipeline) =>
          pipeline.id === id ? { ...pipeline, sharing } : pipeline
        )
    );
    await queryClient.invalidateQueries({ queryKey: crmKeys.pipelines._def });
  }
  return result;
}
