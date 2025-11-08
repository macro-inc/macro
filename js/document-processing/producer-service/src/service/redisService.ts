import { Cluster } from 'ioredis';
import { config } from '../config';
import { getLogger } from '../utils/logger';

let _client: Cluster;

function connect(host: string, port: number) {
  const cluster = new Cluster([{ host, port }], {
    dnsLookup: (address, callback) => callback(null, address),
    redisOptions: {
      tls: config().environment === 'local' ? undefined : {},
    },
  });
  return cluster;
}

export function redisClient(): Cluster {
  if (!_client) {
    throw new Error('Client not initialized');
  }
  return _client;
}

export function initializeRedisClient(host: string, port: number): Cluster {
  if (!_client) {
    try {
      _client = connect(host, port);
    } catch (err) {
      getLogger().error('unable to connect to redis client', { error: err });
      throw new Error('unable to connect to redis client');
    }
  }
  return _client;
}
