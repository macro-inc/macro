import type { NextFunction, Request, Response } from 'express';
import formatError from '../utils/format_error';

/**
 * @description This middleware is used to handle errors that are thrown in the route handlers.
 */
export function error_handler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (error) {
    const formattedError = formatError(error);
    res.status(500).send(formattedError);
    formattedError.method = req.method;
    formattedError.url = req.originalUrl;
    req.logger.error('server_error', { error: formattedError });
    return;
  } else {
    return next();
  }
}
