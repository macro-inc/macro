import type { JobTypes } from '@macro-inc/document-processing-job-types';
import type { JobStatus } from '@macro-inc/document-processing-job-types';
import { producer, validateResponseEvent } from '../producer';
import { lambdaClient } from '../service/lambdaService';
import { getLogger } from '../utils/logger';

export function sendResponse({
  event,
  data,
  jobId,
  error,
  message,
}: {
  event: JobTypes;
  data?: { [name: string]: any };
  jobId: string;
  error?: boolean;
  message?: string;
}) {
  const logger = getLogger();
  try {
    const result = {
      jobId,
      jobType: event,
      data,
      error,
      message,
    };
    validateResponseEvent(event, result);
    const payload = JSON.stringify(result);
    producer().send([event, jobId, payload]);
    logger.debug('response sent', { job_id: jobId, job_type: event });
  } catch (err) {
    logger.error('response data not valid', {
      job_id: jobId,
      job_type: event,
      data,
      error: err,
    });
    throw new Error('Invalid response data');
  }
}

export function sendFailureResponse({
  event,
  jobId,
  message,
}: {
  event: JobTypes;
  jobId: string;
  message: string;
}) {
  const logger = getLogger();
  const result = {
    jobId,
    jobType: event,
    error: true,
    message,
  };
  const payload = JSON.stringify(result);
  producer().send([event, jobId, payload]);
  logger.debug('response sent', { job_id: jobId, job_type: event, message });
}

export async function sendWSResponse({
  jobId,
  jobStatus,
  message,
}: {
  message: string;
  jobId: string;
  jobStatus: JobStatus;
}) {
  const logger = getLogger();

  const body = {
    jobId,
    status: jobStatus,
    // We wrap all of the results in this data object to be consumed by the WS
    data: {
      message,
    },
  };

  logger.debug('sending response to ws', {
    job_id: jobId,
    job_status: jobStatus,
  });
  try {
    await lambdaClient().send_response(body);
  } catch (err) {
    logger.error('unable to send response to ws', {
      job_id: jobId,
      job_status: jobStatus,
      message: message,
      error: err,
    });
  }
}
