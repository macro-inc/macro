import type { SessionConfigOption } from '@service-agent-fold/generated/types';

export type SelectSessionConfigOption = Extract<
  SessionConfigOption,
  { type: 'select' }
>;

/** Find one select by ACP semantic category, with an id fallback for agents
 * that predate categories. */
export function selectConfigOption(
  options: readonly SessionConfigOption[],
  category: string,
  fallbackId: string
): SelectSessionConfigOption | undefined {
  const candidate =
    options.find((option) => option.category === category) ??
    options.find((option) => option.id === fallbackId);
  return candidate?.type === 'select' ? candidate : undefined;
}

export function modelConfigOption(
  options: readonly SessionConfigOption[]
): SelectSessionConfigOption | undefined {
  return selectConfigOption(options, 'model', 'model');
}

export function effortConfigOption(
  options: readonly SessionConfigOption[]
): SelectSessionConfigOption | undefined {
  return selectConfigOption(options, 'thought_level', 'reasoning_effort');
}

/** Opaque harness setting selected alongside a model. */
export type EffortSelection = { configId: string; value: string };
export type EffortChoice = EffortSelection & { name: string };

export function effortLabel(
  option: SelectSessionConfigOption | undefined,
  value?: string
) {
  return option?.options.find(
    (choice) => choice.value === (value ?? option.currentValue)
  )?.name;
}
