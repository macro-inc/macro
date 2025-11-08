import type { JobStatus } from '@macro-inc/document-processing-job-types';
import { lambdaClient } from '../service/lambdaService';
import { getLogger } from '../utils/logger';

export async function sendResponse({
  jobId,
  jobStatus,
  data,
  error,
  message,
}: {
  data?: { [name: string]: any };
  error?: boolean;
  message?: string;
  jobId: string;
  jobStatus: JobStatus;
}) {
  const logger = getLogger();

  const body = {
    jobId,
    status: jobStatus,
    // We wrap all of the results in this data object to be consumed by the WS
    data: {
      data,
      // error should be false by default
      error: error === undefined ? false : error,
      message,
    },
  };

  logger.debug('sending response to ws', {
    job: { job_id: jobId, status: jobStatus },
  });
  await lambdaClient().invoke(body, {
    job_id: jobId,
    job_status: jobStatus,
    error,
    message,
  });
}
