import { thrownResultErrorHasCode } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { runDocumentProgram } from '../queries/document-programs';
import {
  type PreviewFrame,
  type RunReplyMessage,
  readRunRequest,
} from './frame-helper';

export type ProgramHostOptions = {
  documentId: string;
  /** The build the frame shows; a run of a newer build is refused. */
  sourceHash: string;
  token: string;
  /** The document changed since this build; fetch the current one. */
  onStale: () => void;
  /** A run failed; `message` is what the page's call rejects with. */
  onFailure: (message: string) => void;
  /** Replaceable for tests; defaults to the server run. */
  run?: typeof runDocumentProgram;
};

/**
 * Answer a preview frame's `macro.run` requests by running that program of
 * the frame's build on the server as the viewer, and post only the outcome
 * back. Returns the detach function.
 */
export function attachProgramHost(
  frame: PreviewFrame,
  options: ProgramHostOptions
): () => void {
  const run = options.run ?? runDocumentProgram;
  const controller = new AbortController();

  const onMessage = async (event: MessageEvent) => {
    const page = frame.contentWindow;
    if (!page || event.source !== page) return;
    const request = readRunRequest(event.data, options.token);
    if (!request) return;
    const { id, token } = request;
    // Answer the window that asked: a frame moved in the document loads its
    // page afresh in a new window, whose own calls reuse these ids.
    const reply = (message: RunReplyMessage) => {
      page.postMessage(message, '*');
    };
    const fail = (message: string) => {
      reply({ type: 'macro:error', token, id, message });
      options.onFailure(message);
    };
    try {
      // The server run's request joins this span through fetchWithToken's
      // captured context, so one trace covers the frame's call to its result.
      const receipt = await Telemetry.span(
        'block_code.run_document_program',
        async (span) => {
          span.setAttr('document.id', options.documentId);
          span.setAttr('code_mode.program', request.program);
          try {
            const receipt = await run(
              options.documentId,
              {
                sourceHash: options.sourceHash,
                program: request.program,
                arguments: request.arguments,
              },
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
          result: programValue(receipt.result),
        });
      } else {
        fail(receipt.error ?? `The program ${receipt.status}.`);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (thrownResultErrorHasCode(error, 'DOCUMENT_CHANGED'))
        options.onStale();
      fail(
        error instanceof Error ? error.message : 'The program could not run.'
      );
    }
  };

  window.addEventListener('message', onMessage);
  return () => {
    controller.abort();
    window.removeEventListener('message', onMessage);
  };
}

/**
 * The value the program returned: the runtime wraps it as `{ data }`, and the
 * page's typed calls expect it bare.
 */
function programValue(result: unknown): unknown {
  if (typeof result !== 'object' || result === null || !('data' in result))
    return null;
  return result.data;
}
