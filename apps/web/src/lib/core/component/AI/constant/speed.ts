import { Model } from './model';

/** Processing tiers, in the backend `ModelSpeed` spelling. */
export type ModelSpeed = 'standard' | 'priority' | 'fast' | 'ultrafast';

export const MODEL_SPEEDS: readonly ModelSpeed[] = [
  'standard',
  'priority',
  'fast',
  'ultrafast',
];

export function isModelSpeed(value: unknown): value is ModelSpeed {
  return MODEL_SPEEDS.includes(value as ModelSpeed);
}

/**
 * The tiers the chat API accepts for `model`, slowest first; mirrors
 * `ModelSpeed::offered` in the agent crate. Agent sessions read the runtime's
 * advertised `speed` option instead. Opus fast mode stays off until it is
 * enabled for the deployment.
 */
export function speedsForModel(model: string): readonly ModelSpeed[] {
  if (model === Model.gpt6Astra || model === Model.gpt61Sol)
    return ['standard', 'priority', 'ultrafast'];
  return ['standard'];
}

/**
 * The tiers of a runtime's `speed` option, when it is Macro's own (standard
 * plus known tiers). Another harness's option of the same id stays opaque.
 */
export function nativeSpeeds(
  values: readonly string[]
): readonly ModelSpeed[] | undefined {
  if (!values.includes('standard') || !values.every(isModelSpeed)) return;
  return values.filter(isModelSpeed);
}

/** The preferred tier when `offered` includes it, else standard. */
export function resolveSpeed(
  preferred: ModelSpeed,
  offered: readonly string[]
): ModelSpeed {
  return offered.includes(preferred) ? preferred : 'standard';
}

export function speedForModel(model: string, preferred: ModelSpeed) {
  return resolveSpeed(preferred, speedsForModel(model));
}
