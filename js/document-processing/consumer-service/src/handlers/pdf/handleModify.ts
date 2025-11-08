import type { Modify } from '@macro-inc/document-processing-job-types';
import { config } from '../../config';
import { pdfService } from '../../service/pdfService';
import { s3Client } from '../../service/s3Service';
import { PdfServiceError } from '../../utils/error';
import { getLogger } from '../../utils/logger';
import { validateSha } from '../../utils/shaValidation';
import { sendResponse } from '../responseHandler';
import { uploadPdf } from '../results/uploadFile';

/**
 * @deprecated
 */
export async function handleModify(jobId: string, data: Modify) {
  const logger = getLogger();
  const metadata = {
    jobId,
    documentKey: data.documentKey,
    sha: data.sha,
    jobType: 'pdf_modify',
  };
  logger.debug('starting job', metadata);

  // retrieve the file from S3
  const fileData = await s3Client().getObject(
    config().docStorageBucket,
    data.documentKey
  );

  if (!fileData) {
    logger.error('file not found', {
      bucket: config().docStorageBucket,
      ...metadata,
    });
    throw new Error('file not found');
  }

  if (!validateSha(Buffer.from(fileData), data.sha)) {
    throw new Error('sha validation failed');
  }

  const result = await pdfService().modify(
    { blob: new Blob([fileData]), name: `${jobId}`, type: 'pdf' },
    data.modificationData,
    data.shouldSaveBookmarks
  );

  if (result.status !== 200) {
    logger.error('modify non-200', {
      response: await result.text(),
      ...metadata,
    });

    throw new PdfServiceError('pdf_modify');
  }

  // Result is the updated file
  const presignedUrl = await uploadPdf(
    s3Client(),
    config().docStorageBucket,
    jobId,
    await result.arrayBuffer()
  );

  // This will throw if it fails and get picked up by consumer
  sendResponse({
    event: 'pdf_modify',
    jobId,
    data: { resultUrl: presignedUrl },
  });
}
