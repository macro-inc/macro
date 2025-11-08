import type { JobTypes } from '@macro-inc/document-processing-job-types';
import { Duration } from 'luxon';
import { Environment } from './environment';
import { RateLimit } from './service/rateLimitService';

export type RateLimitConfig = {
  [name in JobTypes]: RateLimit | undefined;
};

/**
 * @description Creates rate limit configuration given a specific environment
 * Note: The production environment will have 3 of each service vs 1 at lowest
 * scale level. Therefore we can assume the rate should be at least 3x the
 * dev rate.
 */
export function createRateLimitConfig(environment: Environment) {
  switch (environment) {
    case Environment.PROD:
    case Environment.DEV:
      return {
        ping: undefined,
        create_temp_file: new RateLimit(
          500,
          Duration.fromObject({ seconds: 60 })
        ),
        pdf_preprocess: new RateLimit(
          250,
          Duration.fromObject({ seconds: 60 })
        ),
        pdf_modify: new RateLimit(180, Duration.fromObject({ seconds: 60 })),
        pdf_password_encrypt: new RateLimit(
          300,
          Duration.fromObject({ seconds: 60 })
        ),
        pdf_remove_metadata: new RateLimit(
          250,
          Duration.fromObject({ seconds: 60 })
        ),
        pdf_save_init: new RateLimit(250, Duration.fromObject({ seconds: 60 })),
        pdf_save: new RateLimit(250, Duration.fromObject({ seconds: 60 })),
        pdf_save_as: new RateLimit(250, Duration.fromObject({ seconds: 60 })),
        pdf_export: undefined,
        docx_simple_compare: new RateLimit(
          75,
          Duration.fromObject({ seconds: 60 })
        ),
        docx_consolidate: new RateLimit(
          75,
          Duration.fromObject({ seconds: 60 })
        ),
        docx_upload: new RateLimit(500, Duration.fromObject({ seconds: 60 })),
      };
    // No rate limit for local environment
    case Environment.LOCAL:
      return {
        ping: undefined,
        create_temp_file: undefined,
        pdf_preprocess: undefined,
        pdf_modify: undefined,
        pdf_password_encrypt: undefined,
        pdf_remove_metadata: undefined,
        pdf_save_init: undefined,
        pdf_save: undefined,
        pdf_save_as: undefined,
        docx_simple_compare: undefined,
        docx_consolidate: undefined,
        docx_upload: undefined,
        pdf_export: undefined,
      };
  }
}
