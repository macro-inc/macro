import type { DocxUpload } from '@macro-inc/document-processing-job-types';
import { macroDB } from '../../service/macrodbService';
import { getLogger } from '../../utils/logger';
import { sendResponse } from '../responseHandler';

export async function handleDocxUpload(
  jobId: string,
  userId: string,
  data: DocxUpload
) {
  const logger = getLogger();
  const metadata = {
    job_id: jobId,
    job_type: 'docx_upload',
    user_id: userId,
    ...data,
  };
  logger.info('starting job', metadata);

  await macroDB.uploadJob.create({
    data: {
      jobId,
      jobType: 'docx_upload',
    },
  });

  sendResponse({
    event: 'docx_upload',
    jobId,
    data: {
      success: true,
    },
  });
}
