import type { Export } from '@macro-inc/document-processing-job-types';
import { TEMP_FILE_PREFIX, config } from '../../config';
import { documentStorageService } from '../../service/documentStorageService';
import { pdfService } from '../../service/pdfService';
import { s3Client } from '../../service/s3Service';
import { PdfServiceError } from '../../utils/error';
import { getLogger } from '../../utils/logger';
import { sendResponse } from '../responseHandler';
import { validateDocumentPermission } from '../validateDocumentPermission';

export async function handleExport(
  jobId: string,
  data: Export,
  userId?: string
) {
  const logger = getLogger();
  const jobType = 'pdf_export';
  const metadata = {
    job_id: jobId,
    user_id: userId,
    job_type: jobType,
    document_id: data.documentId,
  };

  logger.debug('starting job', metadata);

  await validateDocumentPermission(data.documentId, userId, metadata);

  // Get document metadata through DSS
  // If userId does not match owner, throw unauthorized error
  const documentData = await documentStorageService().get_document(
    data.documentId
  );

  if (!documentData.data) {
    logger.error('unable to get document', {
      ...metadata,
      get_document_response: documentData,
    });
    throw new Error('unable to get document');
  }

  // We can only handle export of pdf for pdf and converted docx files
  if (
    documentData.data.documentMetadata.fileType !== 'pdf' &&
    documentData.data.documentMetadata.fileType !== 'docx'
  ) {
    logger.error('trying to export a non-pdf document', {
      ...metadata,
      document: documentData.data?.documentMetadata,
    });
    throw new Error('trying to export a non-pdf document');
  }

  if (!documentData.data?.documentMetadata) {
    logger.error('unable to find document', {
      ...metadata,
      document: documentData.data?.documentMetadata,
    });
    throw new Error('unable to find document');
  }

  const keyResponse = await documentStorageService().get_document_key(
    documentData.data?.documentMetadata.documentId,
    documentData.data?.documentMetadata.documentVersionId
  );

  if (!keyResponse.data?.key) {
    logger.error('unable to get document key', {
      ...metadata,
      error: keyResponse.message,
    });

    throw new Error('unable to get document key');
  }

  const key = keyResponse.data.key;

  // retrieve the file from S3
  const fileData = await s3Client().getObject(config().docStorageBucket, key);

  if (!fileData) {
    logger.error('file not found', {
      bucket: config().docStorageBucket,
      key,
      ...metadata,
    });
    throw new Error('file not found');
  }

  const modificationDataResponse =
    await documentStorageService().get_full_pdf_modification_data(
      data.documentId
    );
  const modificationData = modificationDataResponse.data;
  logger.debug('retrieved modification data', {
    ...metadata,
    modificationData,
  });

  let uploadData = fileData;
  if (modificationData) {
    logger.debug('modification data found, applying to pdf');
    // Modify the PDF
    const result = await pdfService().modify(
      { blob: new Blob([fileData]), name: `${jobId}`, type: 'pdf' },
      modificationData,
      true
    );

    if (result.status !== 200) {
      logger.error('modify non-200', {
        response: await result.text(),
        modificationData,
        ...metadata,
      });
      throw new PdfServiceError(jobType);
    }

    uploadData = new Uint8Array(await result.arrayBuffer());
  } else {
    logger.debug(
      'no modification data found, passing blank file through',
      metadata
    );
  }

  // upload to temp storage
  const resultKey = `${TEMP_FILE_PREFIX}${jobId}.pdf`;
  await s3Client().putObject(config().docStorageBucket, resultKey, uploadData);

  // return presigned url
  const presignedUrl = await s3Client().getPresignedUrl(
    config().docStorageBucket,
    resultKey
  );
  // This will throw if it fails and get picked up by consumer
  sendResponse({
    event: jobType,
    jobId,
    data: { resultUrl: presignedUrl },
  });
}
