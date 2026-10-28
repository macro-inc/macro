import { Model } from './model';

export type ModelSpeed = 'standard' | 'fast' | 'ultrafast';

/**
 * Only advertise speed tiers this account can use for the exact model.
 * Opus fast mode stays off until Anthropic approves the account.
 */
export function acceleratedSpeed(
  model: string
): Exclude<ModelSpeed, 'standard'> | undefined {
  if (model === Model.gpt6Astra || model === Model.gpt61Sol) return 'ultrafast';
  return undefined;
}

export function speedForModel(model: string, enabled: boolean): ModelSpeed {
  return enabled ? (acceleratedSpeed(model) ?? 'standard') : 'standard';
}
