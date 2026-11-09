import { Telemetry } from '@macro-inc/observability';
import { runDocumentProgram } from '../queries/document-programs';
import { type RunReplyMessage, readRunRequest } from './frame-helper';

/** Runs one frame may have waiting on the server at once. */
export const MAX_IN_FLIGHT_RUNS = 2;

export type ProgramHostOptions = {
  documentId: string;
  token: string;
  /** Replaceable for tests; defaults to the server run. */
  run?: typeof runDocumentProgram;
};

/**
 * Answer a preview frame's `macro.run` requests by running each program on
 * the server as the viewer, and post only the outcome back. Returns the
 * detach function.
 */
export function attachProgramHost(
  frame: HTMLIFrameElement,
  options: ProgramHostOptions
): () => void {
  const run = options.run ?? runDocumentProgram;
  const controller = new AbortController();
  let inFlight = 0;

  const reply = (message: RunReplyMessage) => {
    frame.contentWindow?.postMessage(message, '*');
  };

  const onMessage = async (event: MessageEvent) => {
    if (!frame.contentWindow || event.source !== frame.contentWindow) return;
    const request = readRunRequest(event.data, options.token);
    if (!request) return;
    const { id, token } = request;
    if (inFlight >= MAX_IN_FLIGHT_RUNS) {
      reply({
        type: 'macro:error',
        token,
        id,
        message: `At most ${MAX_IN_FLIGHT_RUNS} programs can run at once; wait for one to finish.`,
      });
      return;
    }
    inFlight += 1;
    try {
      // The server run's request joins this span through fetchWithToken's
      // captured context, so one trace covers the frame's call to its result.
      const receipt = await Telemetry.span(
        'block_code.run_document_program',
        async (span) => {
          span.setAttr('document.id', options.documentId);
          span.setAttr('code_mode.source_bytes', request.source.length);
          try {
            const receipt = await run(
              options.documentId,
              { source: request.source, arguments: request.arguments },
              controller.signal
            );
            span.setAttr('code_mode.status', receipt.status);
            span.setAttr('code_mode.activity', receipt.activity.length);
            return receipt;
          } catch (error) {
            span.error(error);
            throw error;
          }
        }
      );
      if (receipt.status === 'succeeded') {
        reply({
          type: 'macro:result',
          token,
          id,
          result: receipt.result ?? null,
        });
      } else {
        reply({
          type: 'macro:error',
          token,
          id,
          message: receipt.error ?? `The program ${receipt.status}.`,
        });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      reply({
        type: 'macro:error',
        token,
        id,
        message:
          error instanceof Error
            ? error.message
            : 'The program could not run.',
      });
    } finally {
      inFlight -= 1;
    }
  };

  window.addEventListener('message', onMessage);
  return () => {
    controller.abort();
    window.removeEventListener('message', onMessage);
  };
}
