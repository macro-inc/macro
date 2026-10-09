export type DealStage = { id: string; label: string };

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
