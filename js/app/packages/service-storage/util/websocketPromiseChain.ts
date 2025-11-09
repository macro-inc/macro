import { isErr, type MaybeError, onlyErr } from '@core/util/maybeResult';
import { v7 as uuid7 } from 'uuid';

type PromiseHandler = Promise<any> & {
  resolve: (value?: any) => void;
  resolved: boolean;
};

export function createWebsocketPromiseChain<
  FunctionInputArgType extends any[],
  const L extends Array<{
    filter: (data: any) => boolean;
    handler: (
      data: WebsocketJobSubmissionSuccessResponse<any>,
      ...args: FunctionInputArgType
    ) => any;
  }>,
  Results = {
    [K in keyof L]: Promise<ReturnType<L[K]['handler']> | undefined>;
  },
>(
  {
    jobType,
    getInputData,
    timeoutMs,
    ws,
  }: {
    jobType: JobTypeEnum;
    getInputData: (...args: FunctionInputArgType) => any | Promise<any>;
    timeoutMs: number;
    ws: WebSocket;
  },
  listenersChain: L
) {
  const requestId = uuid7();

  const websocketErrorFilter = (
    response: any
  ): MaybeError<'INVALID_RESPONSE' | 'SERVICE_ERROR'> => {
    if (isJobSubmissionErrorResponse(response)) {
      return onlyErr('SERVICE_ERROR', response.error);
    }

    if (!isJobSubmissionSuccessResponse(response)) {
      return onlyErr('INVALID_RESPONSE', 'Invalid response format');
    }

    if (
      isDocumentProcessResponse(response.data) &&
      isDocumentProcessResponseError(response.data)
    ) {
      return onlyErr('SERVICE_ERROR', response.data.message);
    }

    return [null];
  };

  const createResultPromise = (): PromiseHandler => {
    let resolvePromise: (value: any) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
      setTimeout(() => {
        if (!promise.resolved) {
          console.error(`${jobType} failed: TIMEOUT`);
          resolve(undefined);
        }
      }, timeoutMs);
    }) as PromiseHandler;
    promise.finally(() => {
      promise.resolved = true;
    });

    return Object.assign(promise, {
      resolve: resolvePromise!,
      resolved: false,
    });
  };

  const invokeWebsocket = (...args: FunctionInputArgType): Results => {
    const promiseHandlerListeners = listenersChain.map(
      (listener) => [createResultPromise(), listener] as const
    );
    const results = promiseHandlerListeners.map((x) => x[0]);
    const messageHandler = (ev: MessageEvent) => {
      try {
        const response = JSON.parse(ev.data);
        if (response?.macroRequestId !== requestId) return;

        const errorCheck = websocketErrorFilter(response);
        if (isErr(errorCheck)) {
          for (const [promise] of promiseHandlerListeners) {
            console.error(errorCheck[1]);
            if (!promise.resolved) promise.resolve(undefined);
          }
          return;
        }

        const listener = promiseHandlerListeners.find(([, { filter }]) =>
          filter(response)
        );
        if (!listener) return;
        const [promise, { handler }] = listener;
        try {
          if (promise.resolved) {
            console.error('DSS WS handler already resolved');
          } else {
            promise.resolve(handler(response, ...args));
          }
        } catch (e) {
          console.error(e);
          if (!promise.resolved) {
            promise.resolve(undefined);
          }
        }
      } catch (e) {
        console.error(e);
        for (const [promise] of promiseHandlerListeners) {
          if (!promise.resolved) promise.resolve(undefined);
        }
      }
    };

    const closeHandler = () => {
      console.error(`${jobType} failed: WebSocket closed`);
      for (const [promise] of promiseHandlerListeners) {
        if (!promise.resolved) promise.resolve(undefined);
      }
    };

    ws.addEventListener('message', messageHandler);
    ws.addEventListener('close', closeHandler);
    Promise.allSettled(results).then(() => {
      ws.removeEventListener('message', messageHandler);
      ws.removeEventListener('close', closeHandler);
    });

    let maybeInputData = getInputData(...args);
    if (!(maybeInputData instanceof Promise)) {
      maybeInputData = Promise.resolve(maybeInputData);
    }

    maybeInputData.then((inputData: any) => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.error(
          `${jobType} failed: WebSocket is not open (readyState: ${ws.readyState})`
        );
        for (const [promise] of promiseHandlerListeners) {
          if (!promise.resolved) promise.resolve(undefined);
        }
        return;
      }

      ws.send(
        JSON.stringify({
          requestId,
          action: jobType,
          data: inputData,
        })
      );
    });

    return results as Results;
  };

  return invokeWebsocket;
}

// Supporting types and interfaces
export enum JobTypeEnum {
  Ping = 'ping',
  CreateTempFile = 'create_temp_file',
  PdfExport = 'pdf_export',
  PdfPreprocess = 'pdf_preprocess',
  PdfModify = 'pdf_modify',
  PdfPasswordEncrypt = 'pdf_password_encrypt',
  PdfSplitTexts = 'pdf_split_texts',
  PdfRemoveMetadata = 'pdf_remove_metadata',
  DocxSimpleCompare = 'docx_simple_compare',
  DocxConsolidate = 'docx_consolidate',
  DocxUpload = 'docx_upload',
}

const SUCCESS_STATUS = 'Success';
const ERROR_STATUS = 'Error';

type DocumentProcessSuccessResponse = {
  error: false;
  data: Record<string, any>;
};

type DocumentProcessErrorResponse = {
  error: true;
  message: string;
};

type DocumentProcessResponse =
  | DocumentProcessSuccessResponse
  | DocumentProcessErrorResponse;

export type WebsocketJobSubmissionErrorResponse = {
  jobId?: string;
  macroRequestId?: string;
  event?: string;
  requestBody?: any;
  error: string;
  status: typeof ERROR_STATUS;
};

type WebsocketJobSubmissionSuccessResponseBase = {
  jobId: string;
  macroRequestId: string;
  event: string;
  status: typeof SUCCESS_STATUS;
  data: any;
};

export type WebsocketJobSubmissionSuccessResponse<T = unknown> = Omit<
  WebsocketJobSubmissionSuccessResponseBase,
  'data'
> & {
  data: T;
};

export type WebsocketJobSubmissionResponse<T = unknown> =
  | WebsocketJobSubmissionSuccessResponse<T>
  | WebsocketJobSubmissionErrorResponse;

export type ListenerCallback = (
  response: WebsocketJobSubmissionResponse & { macroRequestId: string }
) => void | Promise<void>;

// Type Guards
function isDocumentProcessResponse(data: any): data is DocumentProcessResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'boolean' &&
    ((!data.error && 'data' in data && typeof data.data === 'object') ||
      (data.error && 'message' in data && typeof data.message === 'string'))
  );
}

function isDocumentProcessResponseError(
  response: DocumentProcessResponse
): response is DocumentProcessErrorResponse {
  return response.error;
}

function isJobSubmissionErrorResponse(
  response?: any
): response is WebsocketJobSubmissionErrorResponse {
  return response?.status === ERROR_STATUS;
}

function isJobSubmissionSuccessResponse<T = unknown>(
  response?: any
): response is WebsocketJobSubmissionSuccessResponse<T> {
  return response?.status === SUCCESS_STATUS;
}
