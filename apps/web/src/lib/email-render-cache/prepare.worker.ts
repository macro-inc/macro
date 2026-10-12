import {
  runWorkerRequest,
  type WorkerRequest,
  type WorkerResponse,
} from './worker-protocol';

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  let response: WorkerResponse;
  try {
    response = { id: data.id, result: await runWorkerRequest(data) };
  } catch {
    response = {
      id: data.id,
      error: 'Preparation failed',
    };
  }
  self.postMessage(response);
};
