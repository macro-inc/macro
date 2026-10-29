import { Telemetry } from '@macro-inc/observability';
import { runCanvasInSandbox } from '../sandbox';
import type { CanvasMeasurer } from './render';
import { canvasRevision } from './revision';
import {
  CanvasConflictError,
  type CanvasSession,
  describeCanvas,
} from './session';

/** Main-agent SDK batches use exactly the same guarded commit path as model writers. */
export async function applyCanvasCode(
  session: CanvasSession,
  request: {
    expectedRevision: string;
    code: string;
    snippets?: Record<string, string>;
  },
  measure: CanvasMeasurer,
  signal: AbortSignal
) {
  const baseline = session.snapshot();
  if ((await canvasRevision(baseline)) !== request.expectedRevision)
    throw new CanvasConflictError(
      'Canvas revision changed. ReadCanvas and reconsider this batch; nothing was committed.'
    );
  const ops = await Telemetry.span('canvas.ai.sandbox', async (span) => {
    const ops = await runCanvasInSandbox(request.code, request.snippets);
    span.setAttr('edit.ops_total', ops.length);
    return ops;
  });
  signal.throwIfAborted();
  const outcome = await session.apply(ops, {
    baseline: baseline.document,
    measure,
  });
  const snapshot = session.snapshot();
  return {
    ...outcome,
    canvas: JSON.stringify({
      ...JSON.parse(describeCanvas(snapshot.document)),
      revision: await canvasRevision(snapshot),
      textLayout: outcome.textLayout,
    }),
    summary: `Applied ${outcome.operationsApplied} acknowledged Canvas operations.`,
    usage: [],
  };
}
