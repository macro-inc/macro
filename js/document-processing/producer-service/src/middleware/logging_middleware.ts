import type { NextFunction, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';

export function log_start(req: Request, _res: Response, next: NextFunction) {
  req.request_id = uuid();
  req.start_time = performance.now();
  req.path !== '/health' &&
    req.logger.debug('req_init', {
      request_id: req.request_id,
      path: req.path,
      method: req.method,
    });
  return next();
}

export function log_end(req: Request, res: Response, next: NextFunction) {
  req.start_time = performance.now();
  req.path !== '/health' &&
    req.logger.debug('req_end', {
      request_id: req.request_id,
      status_code: res.statusCode,
      response_time_ms: performance.now() - req.start_time,
    });
  return next();
}
