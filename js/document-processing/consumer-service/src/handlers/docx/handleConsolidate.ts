import type { Consolidate } from '@macro-inc/document-processing-job-types';
import { documentStorageService } from '../../service/documentStorageService';
import { docxService } from '../../service/docxService';
import type { File } from '../../types/file';
import { DocxServiceError } from '../../utils/error';
import { getLogger } from '../../utils/logger';
import { fetchCompareFiles } from '../fetchFile';
import { sendResponse } from '../responseHandler';
import { validateDocumentPermission } from '../validateDocumentPermission';

export async function handleConsolidate(
  jobId: string,
  userId: string,
  data: Consolidate
) {
  const logger = getLogger();
  const metadata = {
    job_id: jobId,
    job_type: 'docx_consolidate',
    user_id: userId,
    source_upload: data.sourceUpload,
    revised_uploads: data.revisedUploads,
    is_pdf_compare: data.isPdfCompare,
  };

  logger.debug('starting job', metadata);

  // Validate that the user has permissions for all documents
  // throws if user does not have permission
  await Promise.all(
    [data.sourceUpload, ...data.revisedUploads].map(async (doc) => {
      await validateDocumentPermission(doc.documentId, userId, metadata);
    })
  );

  const fileObjects: File[] = await fetchCompareFiles(
    jobId,
    userId,
    'docx_consolidate',
    [data.sourceUpload, ...data.revisedUploads]
  );

  const result = await docxService().consolidate({
    sourceUpload: { file: fileObjects[0], ...data.sourceUpload },
    revisedUploads: data.revisedUploads.map((r, i) => ({
      // it's i + 1 since the first object in fileObjects will always be
      // the source upload
      file: fileObjects[i + 1],
      ...r,
    })),
    isPdfCompare: data.isPdfCompare,
  });

  if (result.status !== 200) {
    logger.error('failed to compare', {
      ...metadata,
      response: await result.text(),
    });
    throw new DocxServiceError('docx_consolidate');
  }

  const text = await result.text();
  const base64Data = text.slice(1, -1);
  const byteCharacters = Buffer.from(base64Data, 'base64');

  const promises = await Promise.all([
    documentStorageService().create_docx_document({
      buffer: byteCharacters,
      documentName: `[Conslidate] ${data.sourceUpload.fileName}`,
      owner: userId,
      jobId,
      jobType: 'docx_consolidate',
    }),
    docxService().count_revisions(byteCharacters, jobId),
  ]);

  if (promises[1].status !== 200) {
    logger.error('failed to count revisions', {
      ...metadata,
      response: await result.text(),
    });
    throw new DocxServiceError('docx_consolidate');
  }

  const countRevisionsResponse = await promises[1].json();

  sendResponse({
    event: 'docx_consolidate',
    jobId,
    data: {
      documentMetadata: promises[0],
      insertions: countRevisionsResponse.insertions,
      deletions: countRevisionsResponse.deletions,
    },
  });
}
