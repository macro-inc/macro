import type { RemoveMetadata } from '@macro-inc/document-processing-job-types';
import { config } from '../../config';
import { pdfService } from '../../service/pdfService';
import { s3Client } from '../../service/s3Service';
import { PdfServiceError } from '../../utils/error';
import { getLogger } from '../../utils/logger';
import { validateSha } from '../../utils/shaValidation';
import { sendResponse } from '../responseHandler';
import { uploadPdf } from '../results/uploadFile';

export async function handleRemoveMetadata(
  jobId: string,
  data: RemoveMetadata,
  userId?: string
) {
  const logger = getLogger();
  const metadata = {
    job_id: jobId,
    user_id: userId,
    document_key: data.documentKey,
    sha: data.sha,
    job_type: 'pdf_remove_metadata',
  };
  logger.info('starting job', metadata);

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
    logger.error('sha validation failed', metadata);
    throw new Error('sha validation failed');
  }

  const result = await pdfService().remove_metadata({
    blob: new Blob([fileData]),
    name: `${jobId}`,
    type: 'pdf',
  });

  if (result.status !== 200) {
    logger.error('remove metadata non-200', {
      response: await result.text(),
      ...metadata,
    });
    throw new PdfServiceError('pdf_remove_metadata');
  }

  // Result is the updated file
  const presignedUrl = await uploadPdf(
    s3Client(),
    config().docStorageBucket,
    jobId,
    await result.arrayBuffer()
  );

  sendResponse({
    event: 'pdf_remove_metadata',
    jobId,
    data: { resultUrl: presignedUrl },
  });
}
