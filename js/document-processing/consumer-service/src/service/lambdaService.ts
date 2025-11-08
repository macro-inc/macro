import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { config } from '../config';
import type { Logger } from '../utils/logger';

export class Lambda {
  private inner: LambdaClient;
  private logger: Logger;
  private jobResponseLambda: string;
  private pdfPreprocessLambda: string;
  private decoder: TextDecoder;
  constructor(
    {
      jobResponseLambda,
      pdfPreprocessLambda,
    }: {
      jobResponseLambda: string;
      pdfPreprocessLambda: string;
    },
    logger: Logger
  ) {
    this.inner = new LambdaClient({ region: 'us-east-1' });
    this.logger = logger;
    this.jobResponseLambda = jobResponseLambda;
    this.pdfPreprocessLambda = pdfPreprocessLambda;

    this.decoder = new TextDecoder('utf-8');

    this.logger.debug('initiated Lambda client', {
      jobResponseLambda: this.jobResponseLambda,
      pdfPreprocessLambda: this.pdfPreprocessLambda,
    });
  }

  async preprocess(args: {
    jobId: string;
    bucket: string;
    key: string;
    documentId: string;
  }) {
    if (config().environment === 'local') {
      this.logger.info('invoke', { ...args });
      const res = await invokeLocal(this.pdfPreprocessLambda, args);
      if (res.status !== 200) {
        throw new Error('unable to preprocess document');
      }
      return await res.json();
    }
    const res = await this.inner.send(
      new InvokeCommand({
        FunctionName: this.pdfPreprocessLambda,
        InvocationType: 'RequestResponse',
        LogType: 'None',
        Payload: new Uint8Array(Buffer.from(JSON.stringify(args))),
      })
    );
    if (res.FunctionError) {
      this.logger.error('unable to perform preprocess', {
        job_id: args.jobId,
        bucket: args.bucket,
        key: args.key,
        document_id: args.documentId,
        error: res.FunctionError,
      });
      throw new Error('unable to perform preprocess');
    }
    return JSON.parse(this.decoder.decode(res.Payload));
  }

  async send_response(data: { [name: string]: any }) {
    if (config().environment === 'local' || process.env.NODE_ENV === 'TEST') {
      this.logger.info('invoke', { data });
      return;
    }
    const res = await this.inner.send(
      new InvokeCommand({
        FunctionName: this.jobResponseLambda,
        InvocationType: 'Event',
        LogType: 'None',
        Payload: new Uint8Array(Buffer.from(JSON.stringify(data))),
      })
    );
    if (res.FunctionError) {
      this.logger.error('unable to send result to websocket', {
        ...data,
        error: res.FunctionError,
      });
      throw new Error('unable to send result to websocket');
    }
  }
}

let _lambdaClient: Lambda;

export function lambdaClient(
  {
    jobResponseLambda,
    pdfPreprocessLambda,
  }: {
    jobResponseLambda?: string;
    pdfPreprocessLambda?: string;
  } = {},
  logger?: Logger
) {
  if (!_lambdaClient) {
    if (!logger) {
      throw new Error('logger needed to initialize lambda singleton');
    }
    if (!jobResponseLambda || !pdfPreprocessLambda) {
      throw new Error('lambda names are needed to initialize lambda singleton');
    }
    _lambdaClient = new Lambda(
      {
        jobResponseLambda,
        pdfPreprocessLambda,
      },
      logger
    );
  }
  return _lambdaClient;
}

/**
 * @description When run locally, this allows us to invoke the local lambda
 * where the lambda name is the http address of the lambda to invoke
 */
export async function invokeLocal(lambda: string, body: any) {
  console.log(lambda, body);
  return await fetch(lambda, {
    body: JSON.stringify(body),
    method: 'POST',
  });
}
