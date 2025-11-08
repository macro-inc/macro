import type { NextFunction, Request, Response } from 'express';
import { producer } from '../../producer';

/**
 * @description This function is used to handle incoming jobs
 * At this point in the service, the job has been validated and we have checked
 * if the response already exists in the cache or not
 */
export function handleIncomingJob(
  req: Request<{
    userId?: string;
    email?: string;
    jobId: string;
    event: string;
    data: { [name: string]: any };
  }>,
  res: Response,
  next: NextFunction
) {
  try {
    const payload = JSON.stringify(req.body.data);
    producer().send([
      req.body.event,
      req.body.jobId,
      req.body.userId ?? '',
      req.body.email ?? '',
      payload,
    ]);
    req.logger.info('job sent', {
      job_id: req.job_id,
      job_type: req.event,
      user_id: req.user_id,
      email: req.email,
    });
  } catch (err) {
    return next(err);
  }

  res.json({ success: true });
  next();
}
