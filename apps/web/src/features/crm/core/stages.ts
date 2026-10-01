export type DealStage = { id: string; label: string };
export const NO_STAGE_KEY = '';
export type StageColumn = { key: string; label: string };

export function boardStageColumns(
  stages: readonly DealStage[],
  filterStages: readonly DealStage[],
  selected: readonly string[],
  noStageFilter: string
): StageColumn[] {
  const candidates = [
    ...filterStages.map((stage) => ({ key: stage.id, label: stage.label })),
    { key: NO_STAGE_KEY, label: 'No stage' },
  ];
  if (selected.length === 0) {
    const active = new Set(stages.map((stage) => stage.id));
    return candidates.filter(
      (column) => column.key === NO_STAGE_KEY || active.has(column.key)
    );
  }
  return candidates.filter((column) =>
    selected.includes(column.key === NO_STAGE_KEY ? noStageFilter : column.key)
  );
}

export function canDragCompanyStage(
  stageKey: string,
  canEdit: boolean,
  closed: ReadonlySet<string>,
  canMoveClosed: boolean
): boolean {
  return (
    canEdit &&
    (stageKey === NO_STAGE_KEY || !closed.has(stageKey) || canMoveClosed)
  );
}

export function resolveCompanyStage(input: {
  direct: string | undefined;
  customized: boolean;
  stages: readonly DealStage[];
  legacy: string | undefined;
  legacyMapping?: Readonly<Record<string, string>>;
  legacyLabel: (id: string) => string | undefined;
}): string | undefined {
  const { direct, customized, stages, legacy, legacyMapping, legacyLabel } =
    input;
  if (direct && stages.some((stage) => stage.id === direct)) return direct;
  if (!customized) return direct;
  if (!legacy) return undefined;
  const mapped = legacyMapping?.[legacy];
  if (mapped && stages.some((stage) => stage.id === mapped)) return mapped;
  const label = legacyLabel(legacy)?.toLowerCase();
  return label
    ? stages.find((stage) => stage.label.toLowerCase() === label)?.id
    : undefined;
}
