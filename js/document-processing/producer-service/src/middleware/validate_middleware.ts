import {
  type JobTypes,
  JobValidation,
} from '@macro-inc/document-processing-job-types';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import formatError from '../utils/format_error';

function validateEvent(event: JobTypes, data: { [name: string]: any }): any {
  if (!JobValidation[event]) {
    throw new Error(`event ${event} not supported`);
  }
  // throws if invalid
  return JobValidation[event](data);
}

/**
 * @description Validates the incoming job request to ensure that the request body is valid
 * Attaches the event and job id to the request to be used later
 */
export function validateRequestHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.body) {
    req.logger.error('missing body', { request_id: req.request_id });
    res.status(400).json({ error: true, message: 'invalid request' });
    return;
  }

  if (!req.body.event || !req.body.data || !req.body.jobId) {
    req.logger.error('missing event|data|jobId', {
      request_id: req.request_id,
    });
    res.status(400).json({ error: true, message: 'missing event|data|jobId' });
    return;
  }

  if (req.body.userId) {
    req.user_id = req.body.userId;
  }

  if (req.body.email) {
    req.email = req.body.email;
  }

  try {
    validateEvent(req.body.event, req.body.data);

    req.job_id = req.body.jobId;
    req.event = req.body.event;
  } catch (err) {
    let formattedError;
    if (err instanceof ZodError) {
      formattedError = err.format();
    } else if (err instanceof Error) {
      formattedError = formatError(err);
    }
    res.status(500).send(formattedError);
    req.logger.error('validate_error', {
      request_id: req.request_id,
      error: formattedError,
      user_id: req.user_id,
      email: req.email,
      event: req.event,
      job_id: req.job_id,
    });
    return;
  }

  // request is valid
  return next();
}
