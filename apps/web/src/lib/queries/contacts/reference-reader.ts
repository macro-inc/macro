import { createReplaceableReader } from '@core/util/create-replaceable-reader';
import {
  assertContactReferenceInput,
  type ContactReferenceHost,
  type ContactReferenceRequest,
  type ContactReferenceResolution,
  resolveContactReferences,
} from './references';

export type ContactReferenceReader = (
  viewer: string,
  host: ContactReferenceHost | undefined,
  request: ContactReferenceRequest,
  signal: AbortSignal
) => Promise<ContactReferenceResolution>;

type Input = {
  viewer: string;
  host: ContactReferenceHost | undefined;
  request: ContactReferenceRequest;
};

/** Native scans cannot be interrupted once dispatched. Retain no input history. */
export function createContactReferenceReader(
  reader: ContactReferenceReader = resolveContactReferences
) {
  const queue = createReplaceableReader((input: Input, signal: AbortSignal) =>
    reader(input.viewer, input.host, input.request, signal)
  );
  const read: ContactReferenceReader = async (
    viewer,
    host,
    request,
    signal
  ) => {
    assertContactReferenceInput(request);
    return queue.read({ viewer, host, request }, signal);
  };
  return { read, dispose: queue.dispose };
}
