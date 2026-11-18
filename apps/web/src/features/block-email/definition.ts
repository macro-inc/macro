import { defineBlock, LoadErrors } from '@core/block';
import { lazy } from '@core/util/lazy';
import { ok } from 'neverthrow';

export const definition = defineBlock({
  name: 'email',
  description: 'View and manage email threads',
  component: lazy(() => import('./component/Block')),
  liveTrackingEnabled: true,
  syncServiceEnabled: false,
  defaultFilename: '[No subject]',

  // The thread itself is fetched by the block component (useThreadQuery),
  // which owns loading, offline fallback, and error states — see Block.tsx.
  async load(source) {
    if (source.type === 'dss') {
      return ok({ id: source.id });
    }
    return LoadErrors.INVALID;
  },
  accepted: {},
});
