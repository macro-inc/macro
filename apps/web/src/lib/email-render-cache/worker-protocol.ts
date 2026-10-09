import {
  type BodyOptions,
  type EmailBodyInput,
  type PreparedEmailBody,
  prepareEmailBody,
} from '@macro-inc/email-renderer';
import { digest, sourceTuple } from './keys';

export type WorkerRequest = { id: number } & (
  | { kind: 'source'; input: EmailBodyInput }
  | { kind: 'prepare'; input: EmailBodyInput; options: BodyOptions }
);
export interface WorkerResponse {
  id: number;
  result?: string | PreparedEmailBody;
  error?: string;
}

/** Shared by the worker and the executor's main-thread fallback. */
export async function runWorkerRequest(
  request: WorkerRequest
): Promise<string | PreparedEmailBody> {
  if (request.kind === 'source')
    return await digest(sourceTuple(request.input));
  return prepareEmailBody(request.input, request.options);
}
