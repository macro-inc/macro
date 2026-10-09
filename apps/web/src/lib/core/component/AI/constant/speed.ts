import { Model } from './model';

export type ModelSpeed = 'standard' | 'fast' | 'ultrafast';

/** Only advertise speed tiers supported by the provider for this exact model. */
export function acceleratedSpeed(
  model: string
): Exclude<ModelSpeed, 'standard'> | undefined {
  if (model === Model.gpt6Astra || model === Model.gpt61Sol) return 'ultrafast';
  if (model === Model.opus55) return 'fast';
  return undefined;
}

export function speedForModel(model: string, enabled: boolean): ModelSpeed {
  return enabled ? (acceleratedSpeed(model) ?? 'standard') : 'standard';
}
