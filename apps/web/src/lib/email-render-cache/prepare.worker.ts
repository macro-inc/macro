import { prepareEmailBody } from '@macro-inc/email-renderer';
import type { WorkerRequest, WorkerResponse } from './executor';
import { digest, sourceTuple } from './keys';

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  let response: WorkerResponse;
  try {
    const result =
      data.kind === 'hash'
        ? await digest(data.tuple)
        : data.kind === 'source'
          ? await digest(sourceTuple(data.input))
          : prepareEmailBody(data.input, data.options);
    response = { id: data.id, result };
  } catch {
    response = {
      id: data.id,
      error: 'Preparation failed',
    };
  }
  self.postMessage(response);
};
