import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { ok } from 'neverthrow';
import { lazy } from 'solid-js';

export const definition = defineBlock({
  name: 'agent',
  description: 'View an agent session',
  component: lazy(() => import('./component/Block')),
  liveTrackingEnabled: false,
  async load(source, _intent) {
    // A just-created session's id is the real one from the first frame
    // (`context/pending-session.ts`), so a reloaded or restored URL loads it
    // like any other; a create that never landed fails as a load, not here.
    if (source.type === 'dss') return ok({ id: source.id });
    return LoadErrors.MISSING;
  },
  accepted: {},
});

export type AgentData = ExtractLoadType<(typeof definition)['load']>;
