import { JobResponseValidation } from '@macro-inc/document-processing-job-types';
import type { JobTypes } from '@macro-inc/document-processing-job-types';
import { JobStatus } from '@macro-inc/document-processing-job-types';
import zmq, { type Socket } from 'zeromq';
import { sendResponse } from './handlers/responseHandler';
import { getLogger } from './utils/logger';

let _consumer: Socket = zmq.socket('sub');
export function consumer() {
  return _consumer;
}

export function initializeConsumer(consumerHost: string) {
  const logger = getLogger();
  _consumer = _consumer.connect(`tcp://${consumerHost}:42070`);
  _consumer = _consumer.subscribe('');

  _consumer.on('message', (event: string, jobId: string, data: string) => {
    handleJob({
      event: event.toString() as JobTypes,
      jobId: jobId.toString(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: JSON.parse(data),
    }).catch((err) => {
      logger.error('uncaught error handling job', {
        event,
        jobId,
        data,
        error: err,
      });
    });
  });

  logger.info('Consumer connected to port 42070');
}

export async function handleJob({
  event,
  jobId,
  data,
}: {
  event: JobTypes;
  jobId: string;
  data: { [name: string]: any };
}) {
  const logger = getLogger();
  logger.debug('event received', { event, jobId, data });
  try {
    if (JobResponseValidation[event] === undefined) {
      throw new Error(`event ${event} not supported`);
    }
    const result = JobResponseValidation[event](data);

    await sendResponse({
      jobId,
      jobStatus: result.error ? JobStatus.Failed : JobStatus.Completed,
      data: result.data,
      error: result.error,
      message: result.message,
    });
  } catch (err) {
    logger.error('unable to validate data', { error: err, event, jobId, data });
    await sendResponse({
      jobId,
      jobStatus: JobStatus.Failed,
      error: true,
      message: 'unable to validate result data',
    });
  }
}
