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

/** The in-memory agent's option for what its turns run on. */
export const FUNDING_CONFIG_ID = 'funding';

/** Macro's AI allowance, or the team's own provider API key. */
export type SessionFunding = 'macro' | 'team_api_key';

/** The funding option, present only when the owner's team has a usable key. */
export function fundingConfigOption(
  options: readonly SessionConfigOption[]
): SelectSessionConfigOption | undefined {
  const candidate = options.find((option) => option.id === FUNDING_CONFIG_ID);
  return candidate?.type === 'select' ? candidate : undefined;
}

/** Whether the session's turns run on the team's own API key. */
export function usesTeamApiKey(
  options: readonly SessionConfigOption[]
): boolean {
  return fundingConfigOption(options)?.currentValue === 'team_api_key';
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
