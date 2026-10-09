import { throwOnErr } from '@core/util/result';
import { queryReadyGate } from '@queries/gate';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { PipelinesSource } from '../context/pipelines';
import type { Pipeline } from '../core/pipeline';
import type { CrmQueryDependencies } from './dependencies';
import { crmKeys } from './keys';

export function createPipelinesSource(
  deps: CrmQueryDependencies,
  teamId: Accessor<string | undefined>
): PipelinesSource {
  const query = useQuery(
    () => ({
      queryKey: crmKeys.pipelines(teamId()).queryKey,
      queryFn: () => throwOnErr(() => deps.storage.listCrmPipelines()),
      enabled: !!teamId(),
    }),
    () => deps.client
  );
  const refresh = async () => {
    await deps.client.invalidateQueries({
      queryKey: crmKeys.pipelines(teamId()).queryKey,
    });
  };
  async function refreshAfterSave() {
    try {
      await refresh();
    } catch {
      deps.feedback.failure(
        'Saved, but could not refresh pipelines. Please refresh the view.'
      );
    }
  }
  function update(id: string, change?: Partial<Pipeline>) {
    deps.client.setQueryData<Pipeline[]>(
      crmKeys.pipelines(teamId()).queryKey,
      (before) =>
        before?.flatMap((pipeline) =>
          pipeline.id === id
            ? change
              ? [{ ...pipeline, ...change }]
              : []
            : [pipeline]
        )
    );
    void refreshAfterSave();
  }
  return {
    pipelines: () => (queryReadyGate(query) ? query.data : []),
    loading: () => query.isLoading,
    error: () => query.isError,
    refresh,
    create: async (input) => {
      const pipeline = await throwOnErr(() =>
        deps.storage.createCrmPipeline(input)
      );
      deps.client.setQueryData(
        crmKeys.pipelines(pipeline.teamId).queryKey,
        (old: (typeof pipeline)[] | undefined) => [...(old ?? []), pipeline]
      );
      void refreshAfterSave();
      return pipeline;
    },
    rename: async (id, name) => {
      await throwOnErr(() => deps.storage.renameCrmPipeline(id, name));
      update(id, { name });
    },
    trash: async (id) => {
      await throwOnErr(() => deps.storage.trashCrmPipeline(id));
      update(id);
    },
  };
}
