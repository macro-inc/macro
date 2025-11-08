import {
  type Preprocess,
  PreprocessInvokeSchema,
  is_preprocess_invoke,
  is_preprocess_upload,
} from '@macro-inc/document-processing-job-types';
import { config } from '../../config';
import { sendResponse } from '../../handlers/responseHandler';
import { documentStorageService } from '../../service/documentStorageService';
import { lambdaClient } from '../../service/lambdaService';
import { macroDB } from '../../service/macrodbService';
import { getLogger } from '../../utils/logger';
import { checkForCachedResult } from '../results/checkForCachedResult';
import { validateDocumentPermission } from '../validateDocumentPermission';

export async function handlePreprocess(
  jobId: string,
  d: Preprocess,
  userId?: string
) {
  const logger = getLogger();
  const jobType = 'pdf_preprocess';
  const metadata: { [name: string]: any } = {
    job_id: jobId,
    user_id: userId,
    job_type: jobType,
    data: d,
  };
  logger.debug('starting job', metadata);

  if (is_preprocess_invoke(d)) {
    logger.info('Parsing preprocess invoke data', {
      ...metadata,
      dataToParse: d,
    });
    const parseData = PreprocessInvokeSchema.safeParse(d);
    if (!parseData.data) {
      logger.error('preprocess invoke data was not able to be parsed', {
        ...metadata,
        parseDataError: parseData.error,
      });
      throw new Error('unable to parse preprocess invoke data');
    }
    const data = parseData.data;

    metadata.document_id = data.documentId;
    metadata.document_version_id = data.documentVersionId;

    await validateDocumentPermission(data.documentId, userId, metadata);

    const cachedResult = await checkForCachedResult(macroDB, logger, {
      jobId,
      jobType: 'pdf_preprocess',
      documentId: data.documentId,
    });

    if (cachedResult) {
      logger.debug('cached result found', metadata);
      sendResponse({
        event: 'pdf_preprocess',
        jobId,
        data: { documentId: data.documentId },
      });
      return;
    }

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

    // We explicitly don't wait out the response here because we send the ws
    // update inside of the preprocess lambda
    lambdaClient()
      .preprocess({
        jobId,
        documentId: data.documentId,
        bucket: config().docStorageBucket,
        key: key.data.key,
      })
      .catch((err) => {
        logger.error('unable to preprocess', {
          ...metadata,
          error: err.message,
        });
        throw new Error('unable to preprocess');
      });

    logger.info('pdf_preprocess started', metadata);
    return;
  } else if (is_preprocess_upload(d)) {
    await macroDB.uploadJob.create({
      data: {
        jobId,
        jobType,
      },
    });

    sendResponse({
      event: jobType,
      jobId,
      data: {
        success: true,
      },
    });
    return;
  }
}
