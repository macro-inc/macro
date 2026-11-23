import type {
  EffortChoice,
  SelectSessionConfigOption,
} from '../../block-agent/state/session-config';

export function thinkingLevel(
  option: SelectSessionConfigOption | undefined,
  value?: string
): number {
  if (!option) return 0;
  const index = option.options.findIndex(
    (choice) => choice.value === (value ?? option.currentValue)
  );
  return Math.max(0, index);
}

export function thinkingChoice(
  option: SelectSessionConfigOption | undefined,
  level: number
): EffortChoice | undefined {
  if (!option?.options.length || !Number.isFinite(level)) return;
  const index = Math.max(
    0,
    Math.min(option.options.length - 1, Math.round(level))
  );
  const choice = option.options[index];
  return { configId: option.id, value: choice.value, name: choice.name };
}
