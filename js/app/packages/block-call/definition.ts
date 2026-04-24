import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { ok } from '@core/util/maybeResult';
import { CallBlockAdapter } from './component/CallBlockAdapter';

export const definition = defineBlock({
  name: 'call',
  description: '',
  defaultFilename: 'Call',
  component: CallBlockAdapter,
  async load(source, _intent) {
    if (!ENABLE_CALLS()) return LoadErrors.MISSING;
    if (source.type === 'dss') {
      return ok({ id: source.id });
    }
    return LoadErrors.MISSING;
  },
  accepted: {},
});

export type CallData = ExtractLoadType<(typeof definition)['load']>;
