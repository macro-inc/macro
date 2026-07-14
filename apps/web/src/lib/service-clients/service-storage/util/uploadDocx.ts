import { ENABLE_DOCX_TO_PDF } from '@core/constant/featureFlags';
import {
  createWebsocketPromiseChain,
  JobTypeEnum,
  type WebsocketJobSubmissionSuccessResponse,
} from './websocketPromiseChain';

const PROMISE_TIMEOUT_MS = 15000; // 15 seconds

export function uploadDocx(ws: WebSocket) {
  const websocketChain = createWebsocketPromiseChain(
    {
      jobType: JobTypeEnum.DocxUpload,
      getInputData: () => ({}),
      timeoutMs: PROMISE_TIMEOUT_MS,
      ws,
    },
    [
      {
        filter: (response) => response.data?.data?.success,
        handler: (
          response: WebsocketJobSubmissionSuccessResponse<{
            data: { success: boolean };
          }>
        ) => {
          return response.jobId;
        },
      },
      ENABLE_DOCX_TO_PDF
        ? // When conversion is enabled, we get the job completion from the convert service
          {
            filter: (response) => response.data?.data?.converted,
            handler: (
              response: WebsocketJobSubmissionSuccessResponse<{
                data: { converted: boolean };
              }>
            ) => {
              return response.data.data.converted;
            },
          }
        : // When conversion is disabled, we get the job completion from the docx unzip lambda
          {
            filter: (response) => Array.isArray(response.data?.data?.bomParts),
            handler: (
              response: WebsocketJobSubmissionSuccessResponse<{
                data: { bomParts: any[] };
              }>
            ) => {
              return response.data.data.bomParts.length > 0;
            },
          },
    ]
  );
  return websocketChain();
}
