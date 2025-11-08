import type { SimpleCompare } from '@macro-inc/document-processing-job-types';
import { documentStorageService } from '../../service/documentStorageService';
import { docxService } from '../../service/docxService';
import type { File } from '../../types/file';
import { DocxServiceError } from '../../utils/error';
import { getLogger } from '../../utils/logger';
import { fetchCompareFiles } from '../fetchFile';
import { sendResponse } from '../responseHandler';
import { validateDocumentPermission } from '../validateDocumentPermission';

export async function handleSimpleCompare(
  jobId: string,
  userId: string,
  data: SimpleCompare
) {
  const logger = getLogger();
  const metadata = {
    job_id: jobId,
    job_type: 'docx_simple_compare',
    user_id: userId,
    source_upload: data.sourceUpload,
    revised_upload: data.revisedUpload,
    is_pdf_compare: data.isPdfCompare,
  };

  logger.debug('starting job', metadata);

  // Validate that the user has permissions for all documents
  // throws if user does not have permission
  await Promise.all(
    [data.sourceUpload, data.revisedUpload].map(async (doc) => {
      await validateDocumentPermission(doc.documentId, userId, metadata);
    })
  );

  // Rebuild documents and create file objects for request
  const fileObjects: File[] = await fetchCompareFiles(
    jobId,
    userId,
    'docx_simple_compare',
    [data.sourceUpload, data.revisedUpload]
  );

  const result = await docxService().simple_compare({
    v1: fileObjects[0],
    v2: fileObjects[1],
    revisedUpload: { ...data.revisedUpload },
    keepComments: data.keepComments,
    isPdfCompare: data.isPdfCompare,
  });

  if (result.status !== 200) {
    logger.error('failed to compare', {
      ...metadata,
      response: await result.text(),
    });
    throw new DocxServiceError('docx_simple_compare');
  }

  const text = await result.text();
  const base64Data = text.slice(1, -1);
  const byteCharacters = Buffer.from(base64Data, 'base64');

  const promises = await Promise.all([
    documentStorageService().create_docx_document({
      buffer: byteCharacters,
      documentName: `[Compare] ${data.sourceUpload.fileName} to ${data.revisedUpload.fileName}`,
      owner: userId,
      jobId,
      jobType: 'docx_simple_compare',
    }),
    docxService().count_revisions(byteCharacters, jobId),
  ]);

  if (promises[1].status !== 200) {
    logger.error('failed to count revisions', {
      ...metadata,
      response: await result.text(),
    });
    throw new DocxServiceError('docx_simple_compare');
  }

  const countRevisionsResponse = await promises[1].json();

  sendResponse({
    event: 'docx_simple_compare',
    jobId,
    data: {
      documentMetadata: promises[0],
      insertions: countRevisionsResponse.insertions,
      deletions: countRevisionsResponse.deletions,
    },
  });
}
