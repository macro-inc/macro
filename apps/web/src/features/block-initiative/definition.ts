import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { ok } from 'neverthrow';
import { lazy } from 'solid-js';

/** A task project (initiative); `project` is a folder block. */
export const definition = defineBlock({
  name: 'initiative',
  description: 'View a task project',
  component: lazy(() => import('./component/InitiativeBlock')),
  async load(source, _intent) {
    if (source.type === 'dss') {
      return ok({ id: source.id });
    }
    return LoadErrors.MISSING;
  },
  accepted: {},
});

export type InitiativeData = ExtractLoadType<(typeof definition)['load']>;
