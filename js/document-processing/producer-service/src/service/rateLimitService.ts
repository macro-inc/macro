import type { JobTypes } from '@macro-inc/document-processing-job-types';
import type { Cluster } from 'ioredis';
import type { Duration } from 'luxon';
import type { RateLimitConfig } from '../rateLimitConfig';
import type { Logger } from '../utils/logger';
import { initializeRedisClient } from './redisService';

// Base key for rate limit values in redis
export const RATE_LIMIT_BASE_KEY = 'document_processing_rate_limit';

/**
 * @description RateLimit represents a rate limit for a given key
 * This is to be used by the RateLimitService to know whether to limit or allow
 * a given request
 */
export class RateLimit {
  count: number;
  period: Duration;

  constructor(count: number, period: Duration) {
    this.count = count;
    this.period = period;
  }

  get inverse(): number {
    return this.period.as('seconds') / this.count;
  }
}

/**
 * @description The RateLimitService is a class that provides rate limiting functionality
 * using the Generic Cell Rate Algorithm strategy
 */
export class RateLimitService {
  private logger: Logger;
  private inner: Cluster;
  private rateLimitConfig: RateLimitConfig;
  constructor(
    host: string,
    port: number,
    rateLimitConfig: RateLimitConfig,
    logger: Logger
  ) {
    this.logger = logger;
    this.inner = initializeRedisClient(host, port);
    this.rateLimitConfig = rateLimitConfig;
    this.logger.info('initiated RateLimit service');
  }

  async getTAT(key: string): Promise<Date> {
    const tatStr = await this.inner.get(key);
    return tatStr ? new Date(tatStr) : new Date();
  }

  async setTAT(key: string, tat: Date): Promise<void> {
    await this.inner.set(key, tat.toISOString());
  }

  /**
   * @description Attempts to update the rate limit.
   * If the request needs to be rate limited the Duration of the rate limit is
   * returned. Otherwise nothing is returned.
   */
  async update(jobType: JobTypes): Promise<Duration | undefined> {
    const limit = this.rateLimitConfig[jobType];
    const key = `${RATE_LIMIT_BASE_KEY}:${jobType}`;
    // This job does not have a rate limit
    if (!limit) {
      this.logger.debug('job does not have a rate limit', { jobType, key });
      return;
    }
    const now = new Date();
    const tat = new Date(
      Math.max((await this.getTAT(key)).getTime(), now.getTime())
    );
    const separation = (tat.getTime() - now.getTime()) / 1000;
    const maxInterval = limit.period.as('seconds') - limit.inverse;

    if (separation > maxInterval) {
      this.logger.debug('rate limit hit', { jobType, key });
      return limit.period;
    } else {
      const newTAT = new Date(
        Math.max(tat.getTime(), now.getTime()) + limit.inverse * 1000
      );
      await this.setTAT(key, newTAT);
      return;
    }
  }
}

let _rateLimit: RateLimitService;

export function rateLimitService(
  rateLimitConfig?: RateLimitConfig,
  host?: string,
  port?: number,
  logger?: Logger
) {
  if (!_rateLimit) {
    if (!rateLimitConfig) {
      throw new Error(
        'rateLimitConfig needed to initialize rate limit service singleton'
      );
    }
    if (!logger) {
      throw new Error(
        'logger needed to initialize rate limit service singleton'
      );
    }
    if (!host) {
      throw new Error('host needed to initialize rate limit service singleton');
    }
    if (!port) {
      throw new Error('port needed to initialize rate limit service singleton');
    }
    _rateLimit = new RateLimitService(host, port, rateLimitConfig, logger);
  }
  return _rateLimit;
}
