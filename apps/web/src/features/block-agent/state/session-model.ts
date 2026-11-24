import { currentModelId } from '@core/component/AI/constant/model';
import { uniqueByKey } from '@core/util/compareUtils';
import { isMacroHarness } from '../../agents-view/core/agent-kind';

/**
 * The model a session shows. A Macro session last run on a retired model moves
 * to its replacement when it next opens, so it shows as that replacement.
 * Other runtimes keep their own model ids.
 */
export function shownSessionModel(
  model: string,
  harness: string | null | undefined
): string {
  return isMacroHarness(harness) ? currentModelId(model) : model;
}

/** The runtime's own model list with each shown model once: a runtime that
 * last reported before a model retired still lists it. */
export function shownSessionModels<T extends { id: string }>(
  models: readonly T[],
  harness: string | null | undefined
): T[] {
  return uniqueByKey(
    models.map((model) => ({
      ...model,
      id: shownSessionModel(model.id, harness),
    })),
    (model) => model.id
  );
}
