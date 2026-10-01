import { type Accessor, createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type {
  CrmCapabilities,
  CrmMutation,
  CrmStageInput,
  CrmStagesResult as CrmStagesResponse,
  DealStages,
  TeamConfigSource,
} from '../context/crm-sources';
import type { DealStage } from '../core/stages';

function toStageInputs(stages: DealStage[]): CrmStageInput[] {
  return stages.map((stage) => ({ id: stage.id, label: stage.label }));
}
export function createStageEditor(input: {
  dealStages: DealStages;
  crmPermissions: Pick<CrmCapabilities, 'canEditStages'>;
  teamCrmConfig: TeamConfigSource;
  closedStageIds: Accessor<Set<string>>;
  replaceMutation: CrmMutation<CrmStageInput[], CrmStagesResponse>;
  resetMutation: CrmMutation<void>;
  onSuccess(message: string): void;
}) {
  const {
    dealStages,
    crmPermissions,
    teamCrmConfig,
    closedStageIds,
    replaceMutation,
    resetMutation,
  } = input;
  const [newStageName, setNewStageName] = createSignal('');
  const [stageToDelete, setStageToDelete] = createSignal<DealStage | null>(
    null
  );
  const [showResetModal, setShowResetModal] = createSignal(false);

  const canEdit = () => crmPermissions.canEditStages();
  const pending = () => replaceMutation.isPending || resetMutation.isPending;
  const loading = () => dealStages.isLoading() || teamCrmConfig.isLoading();
  const failed = () => dealStages.isError() || teamCrmConfig.isError();
  const busy = () => pending() || teamCrmConfig.update.isPending;
  const blocked = () => busy() || loading() || failed();
  const [drafts, setDrafts] = createStore<Record<string, string | undefined>>(
    {}
  );

  // Row objects are reused across refetches when their id and label are
  // unchanged, so `<For>` keeps each row's DOM (and a focused reorder handle)
  // instead of remounting the whole list after every save.
  const stableStages = createMemo<DealStage[]>((previous) => {
    const byId = new Map(previous.map((stage) => [stage.id, stage]));
    return dealStages.stages().map((stage) => {
      const existing = byId.get(stage.id);
      return existing?.label === stage.label ? existing : stage;
    });
  }, []);

  // Order shown while a reorder is in flight, so a drop or arrow-key move
  // lands immediately instead of snapping back until the refetch resolves.
  const [pendingOrder, setPendingOrder] = createSignal<string[] | null>(null);
  const orderedStages = createMemo<DealStage[]>(() => {
    const stages = stableStages();
    const order = pendingOrder();
    if (!order) return stages;
    const byId = new Map(stages.map((stage) => [stage.id, stage]));
    const ordered = order.flatMap((id) => byId.get(id) ?? []);
    return ordered.length === stages.length ? ordered : stages;
  });
  const stageIds = () => orderedStages().map((stage) => stage.id);

  /** Screen reader announcement for keyboard and drag reorders. */
  const [announcement, setAnnouncement] = createSignal('');

  const replace = (
    stages: CrmStageInput[],
    options?: {
      onSuccess?: (result: CrmStagesResponse) => void;
      onSettled?: () => void;
      successMessage?: string;
    }
  ) => {
    if (blocked()) return;
    replaceMutation.mutate(stages, {
      onSuccess: (result) => {
        if (options?.successMessage) input.onSuccess(options.successMessage);
        options?.onSuccess?.(result);
      },
      onSettled: () => options?.onSettled?.(),
    });
  };

  const handleCustomize = () => {
    const seed = dealStages.stages();
    const closedLabels = new Set(
      seed
        .filter((stage) => closedStageIds().has(stage.id))
        .map((stage) => stage.label)
    );
    const explicitClosed = teamCrmConfig.config().closedStageIds !== undefined;
    replace(
      seed.map((stage) => ({ label: stage.label })),
      {
        successMessage: 'Stages are now customizable',
        onSuccess: (result) => {
          if (!explicitClosed) return;
          teamCrmConfig.update.mutate({
            closedStageIds: result.stages
              .filter((stage) => closedLabels.has(stage.label))
              .map((stage) => stage.id),
          });
        },
      }
    );
  };

  const handleRename = (index: number, label: string) => {
    const stages = toStageInputs(orderedStages());
    const stage = stages[index];
    if (!stage?.id) return;
    const id = stage.id;
    stages[index] = { ...stage, label };
    replace(stages, { onSuccess: () => setDrafts(id, undefined) });
  };

  const reorder = (fromIndex: number, toIndex: number) => {
    const stages = orderedStages();
    const moved = stages[fromIndex];
    if (!moved || toIndex < 0 || toIndex >= stages.length) return;
    if (fromIndex === toIndex || blocked()) return;
    const next = stages.slice();
    next.splice(toIndex, 0, ...next.splice(fromIndex, 1));
    setPendingOrder(next.map((stage) => stage.id));
    setAnnouncement(
      `${moved.label} moved to position ${toIndex + 1} of ${stages.length}`
    );
    replace(toStageInputs(next), { onSettled: () => setPendingOrder(null) });
  };

  const handleMove = (index: number, direction: -1 | 1) =>
    reorder(index, index + direction);

  const handleAddStage = () => {
    const label = newStageName().trim();
    if (label === '') return;
    replace([...toStageInputs(orderedStages()), { label }], {
      onSuccess: () => setNewStageName(''),
    });
  };

  const handleDeleteStage = () => {
    const stage = stageToDelete();
    if (!stage) return;
    replace(toStageInputs(orderedStages().filter((s) => s.id !== stage.id)), {
      onSuccess: () => setStageToDelete(null),
    });
  };

  const handleReset = () => {
    if (blocked()) return;
    resetMutation.mutate(undefined, {
      onSuccess: () => {
        setShowResetModal(false);
        input.onSuccess('Stages reset to Macro defaults');
      },
    });
  };

  const toggleClosedStage = (stageId: string) => {
    if (blocked()) return;
    const next = new Set(closedStageIds());
    if (next.has(stageId)) {
      next.delete(stageId);
    } else {
      next.add(stageId);
    }
    teamCrmConfig.update.mutate({ closedStageIds: [...next] });
  };

  return {
    newStageName,
    setNewStageName,
    stageToDelete,
    setStageToDelete,
    showResetModal,
    setShowResetModal,
    canEdit,
    pending,
    loading,
    failed,
    busy,
    blocked,
    drafts,
    setDrafts,
    orderedStages,
    stageIds,
    announcement,
    handleCustomize,
    handleRename,
    reorder,
    handleMove,
    handleAddStage,
    handleDeleteStage,
    handleReset,
    toggleClosedStage,
  };
}
