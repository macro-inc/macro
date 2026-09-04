import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { callKeys } from '@queries/call/keys';
import { queryClient } from '@queries/client';
import { callServiceClient } from '@service-call/client';
import { err, ok } from 'neverthrow';

import { CallBlockAdapter } from './component/CallBlockAdapter';

export const definition = defineBlock({
  name: 'call',
  description: '',
  defaultFilename: 'Call',
  component: CallBlockAdapter,
  async load(source, _intent) {
    if (!ENABLE_CALLS) return LoadErrors.MISSING;
    if (source.type !== 'dss') return LoadErrors.MISSING;

    const callId = source.id;
    const result = await loadResult(callServiceClient.getCallRecord(callId));
    if (result.isErr()) return err(result.error);
    const record = result.value;

    // Prime the record query so the component renders from cache without a
    // second fetch, and return userAccessLevel so BlockLoader wires the header
    // badge like every other block — no component-side permission plumbing.
    queryClient.setQueryData(callKeys.record(callId).queryKey, record);
    return ok({
      id: callId,
      userAccessLevel: record.userAccessLevel ?? undefined,
    });
  },
  accepted: {},
});

export type CallData = ExtractLoadType<(typeof definition)['load']>;
