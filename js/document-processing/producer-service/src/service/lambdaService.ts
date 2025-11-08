import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { config } from '../config';
import type { Logger } from '../utils/logger';

export class Lambda {
  private inner: LambdaClient;
  private logger: Logger;
  private jobResponseLambda: string;
  constructor(jobResponseLambda: string, logger: Logger) {
    this.inner = new LambdaClient({ region: 'us-east-1' });
    this.logger = logger;
    this.jobResponseLambda = jobResponseLambda;
    this.logger.debug('initiated Lambda client', { jobResponseLambda });
  }

  async invoke(
    data: { [name: string]: any },
    metadata?: { [name: string]: any }
  ) {
    if (config().environment === 'local') {
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
        error: res.FunctionError,
        ...metadata,
      });
      throw new Error('unable to send result to websocket');
    }
  }
}

let _lambdaClient: Lambda;

export function lambdaClient(jobResponseLambda?: string, logger?: Logger) {
  if (!_lambdaClient) {
    if (!logger) {
      throw new Error('logger needed to initialize lambda singleton');
    }
    if (!jobResponseLambda) {
      throw new Error(
        'jobResponseLambda needed to initialize lambda singleton'
      );
    }
    _lambdaClient = new Lambda(jobResponseLambda, logger);
  }
  return _lambdaClient;
}
