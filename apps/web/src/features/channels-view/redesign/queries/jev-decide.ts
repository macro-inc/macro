import { cognitionApiServiceClient } from '@service-cognition/client';
import type { JevDecidePort } from '../primitives/create-jev-triage';

/**
 * Live cognition-service adapter for Jev yes/no channel triage.
 * Lives under `queries/` so service clients stay inside the query boundary.
 */
export const liveJevDecide: JevDecidePort = async (payload, signal) => {
  const result = await cognitionApiServiceClient.decide(
    {
      input: payload.input,
      questions: payload.questions,
    },
    signal
  );

  if (result.isOk()) {
    return { ok: true, probabilities: result.value.probabilities };
  }

  const codes = result.error.map((error) => String(error.code ?? ''));
  const unavailable =
    !signal.aborted &&
    codes.some(
      (code) =>
        code === '503' ||
        code === '402' ||
        code === '404' ||
        code === 'NETWORK_ERROR' ||
        code === 'AI_USAGE_LIMIT' ||
        code === 'SERVICE_UNAVAILABLE'
    );
  return { ok: false, unavailable: unavailable || !signal.aborted };
};
