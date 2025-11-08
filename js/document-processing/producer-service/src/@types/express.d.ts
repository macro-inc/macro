import type { JobTypes } from '../jobTypes/jobTypes';
import type { Logger } from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      logger: Logger;
      request_id: string;
      start_time: number;
      job_id?: string;
      user_id?: string;
      email?: string;
      event?: JobTypes;
    }
  }
}
