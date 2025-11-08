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
  producer().bindSync('tcp://*:42069');
  getLogger().info('Producer bound to port 42069');
}
