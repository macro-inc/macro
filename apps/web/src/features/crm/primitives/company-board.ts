import { createEffect, createMemo, createSignal } from 'solid-js';
import type { CompanyBoardSource } from '../context/company-board-source';
import {
  boardStageColumns,
  canDragCompanyStage,
  NO_STAGE_KEY,
} from '../core/stages';

/** Keeps board moves visible during search and protects newer moves from stale failures. */
export function createCompanyBoard<T extends { id: string }>(
  source: CompanyBoardSource<T>
) {
  const [overrides, setOverrides] = createSignal<ReadonlyMap<string, string>>(
    new Map()
  );
  const clearOverride = (id: string, stage: string) =>
    setOverrides((previous) => {
      if (previous.get(id) !== stage) return previous;
      const next = new Map(previous);
      next.delete(id);
      return next;
    });
  const effectiveStage = (company: T) =>
    overrides().get(company.id) ?? source.resolveStage(company) ?? NO_STAGE_KEY;
  const stageColumns = createMemo(() =>
    boardStageColumns(
      source.stages(),
      source.filterStages(),
      source.selectedStages(),
      source.noStageFilter
    )
  );
  // Acknowledged server/cache values retire the optimistic overlay.
  createEffect(() => {
    const pending = overrides();
    if (!pending.size) return;
    for (const company of source.companies()) {
      const stage = source.resolveStage(company) ?? NO_STAGE_KEY;
      if (pending.get(company.id) === stage) clearOverride(company.id, stage);
    }
  });
  const columns = createMemo(() => {
    const buckets = new Map<string, T[]>(
      stageColumns().map((column) => [column.key, []])
    );
    for (const company of source.companies()) {
      const key = effectiveStage(company);
      (buckets.get(buckets.has(key) ? key : NO_STAGE_KEY) ?? []).push(company);
    }
    return stageColumns().map((column) => ({
      ...column,
      entities: buckets.get(column.key) ?? [],
    }));
  });
  const canDragFrom = (stage: string) =>
    canDragCompanyStage(
      stage,
      source.canEdit(),
      source.closedStages(),
      source.canMoveClosed()
    );
  const moveToStage = (id: string, stage: string) => {
    const company = source.companies().find((company) => company.id === id);
    if (!company || effectiveStage(company) === stage) return;
    setOverrides((previous) => new Map(previous).set(id, stage));
    source.saveStage(id, stage, () => clearOverride(id, stage));
  };
  return { columns, stageColumns, effectiveStage, canDragFrom, moveToStage };
}
