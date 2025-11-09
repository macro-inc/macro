import { isErr } from '@core/util/maybeResult';
import type {
  PreprocessInvoke,
  PreprocessResponseData,
} from '@macro-inc/document-processing-job-types';
import {
  type ProcessingResultResponseType,
  storageServiceClient,
} from '@service-storage/client';
import { createWebSocketJob } from '@service-storage/websocket';

export async function preprocess({
  documentId,
  documentVersionId,
}: {
  documentId: string;
  documentVersionId: number;
}) {
  try {
    const [, parseResult] =
      await storageServiceClient.getDocumentProcessingResult({
        documentId,
        type: 'PREPROCESS',
      });
    if (parseResult) return parseResult.preprocess;
  } catch (e) {
    console.error('preprocess fetch error', e);
  }

  return createWebSocketJob<
    string,
    ProcessingResultResponseType<'PREPROCESS'>,
    PreprocessInvoke,
    PreprocessResponseData
  >({
    data: {
      documentId,
      documentVersionId,
    },
    action: 'pdf_preprocess',
    processResult: async (_data, jobId) => {
      // any data resonse is a success response
      return jobId;
    },
    handleSuccess: async (jobId) => {
      const result = await storageServiceClient.getJobProcessingResult({
        documentId,
        jobId,
        type: 'PREPROCESS',
      });
      if (isErr(result)) {
        throw result;
      }
      return result[1].preprocess;
    },
  });
}
