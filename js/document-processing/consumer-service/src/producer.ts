import {
  JobResponseValidation,
  type JobTypes,
} from '@macro-inc/document-processing-job-types';
import zmq, { type Socket } from 'zeromq';
import { getLogger } from './utils/logger';

let _producer: Socket;
export function producer() {
  if (!_producer) {
    _producer = zmq.socket('pub');
  }
  return _producer;
}

export function initializeProducer() {
  producer().bindSync('tcp://*:42070');
  getLogger().info('Producer bound to port 42070');
}

export function validateResponseEvent(
  event: JobTypes,
  data: { [name: string]: any }
): boolean {
  if (!JobResponseValidation[event]) {
    throw new Error(`event ${event} not supported`);
  }
  // We don't care about the result here, only the fact it is parseable
  return !!JobResponseValidation[event](data);
}
