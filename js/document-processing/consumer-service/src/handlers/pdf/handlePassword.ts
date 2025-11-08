import type { PasswordInput } from '@macro-inc/document-processing-job-types';
import { config } from '../../config';
import { documentStorageService } from '../../service/documentStorageService';
import { pdfService } from '../../service/pdfService';
import { s3Client } from '../../service/s3Service';
import { PdfServiceError } from '../../utils/error';
import { getLogger } from '../../utils/logger';
import { sendResponse } from '../responseHandler';
import { uploadPdf } from '../results/uploadFile';
import { validateDocumentPermission } from '../validateDocumentPermission';

export async function handlePasswordEncrypt(
  jobId: string,
  data: PasswordInput,
  userId?: string
) {
  const logger = getLogger();
  const metadata = {
    job_id: jobId,
    user_id: userId,
    job_type: 'pdf_password_encrypt',
    document_id: data.documentId,
    document_version_id: data.documentVersionId,
  };
  logger.debug('starting job', metadata);

  await validateDocumentPermission(data.documentId, userId, metadata);

  // Get document key from DSS
  const key = await documentStorageService().get_document_key(
    data.documentId,
    data.documentVersionId
  );

  if (key.error || !key.data?.key) {
    logger.error('unable to get document key', {
      ...metadata,
      error: key.message,
      key,
    });
    throw new Error('unable to get document key');
  }

  const documentKey = key.data.key;

  // retrieve the file from S3
  const fileData = await s3Client().getObject(
    config().docStorageBucket,
    documentKey
  );

  if (!fileData) {
    logger.error('file not found', {
      bucket: config().docStorageBucket,
      key: documentKey,
      ...metadata,
    });
    throw new Error('file not found');
  }

  const result = await pdfService().password_encrypt(
    { blob: new Blob([fileData]), name: `${jobId}`, type: 'pdf' },
    data.password
  );

  if (result.status !== 200) {
    logger.error('password_encrypt non-200', {
      response: await result.text(),
      ...metadata,
    });
    throw new PdfServiceError('pdf_password_encrypt');
  }

  // Result is the updated file
  const presignedUrl = await uploadPdf(
    s3Client(),
    config().docStorageBucket,
    jobId,
    await result.arrayBuffer()
  );

  sendResponse({
    event: 'pdf_password_encrypt',
    jobId,
    data: { resultUrl: presignedUrl },
  });
}
