import type { CreateTempFile } from '@macro-inc/document-processing-job-types';
import { TEMP_FILE_PREFIX, config } from '../../config';
import { s3Client } from '../../service/s3Service';
import { getLogger } from '../../utils/logger';
import { sendResponse } from '../responseHandler';

export async function handleCreateTempFile(
  jobId: string,
  data: CreateTempFile
) {
  const logger = getLogger();
  const metadata = {
    job_id: jobId,
    job_type: 'create_temp_file',
    sha: data.sha,
    extension: data.extension,
  };
  logger.debug('starting job', { ...metadata });
  const resultKey = `${TEMP_FILE_PREFIX}${jobId}-${data.sha}.${data.extension}`;
  const presignedUrl = await s3Client().putPresignedUrl(
    config().docStorageBucket,
    resultKey,
    data.sha,
    data.extension
  );

  sendResponse({
    event: 'create_temp_file',
    jobId,
    data: {
      resultUrl: presignedUrl,
      resultKey,
    },
  });
}
