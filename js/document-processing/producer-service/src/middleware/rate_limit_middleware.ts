import type { NextFunction, Request, Response } from 'express';
import { rateLimitService } from '../service/rateLimitService';

export async function rateLimitHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.event) {
    req.logger.error('event is missing', { body: req.body });
    res.status(400).json({ error: true, mesaage: 'event is missing' });
    return;
  }

  // Rate limit exceeded
  const rateLimitDuration = await rateLimitService().update(req.event);
  if (rateLimitDuration) {
    // If the rate limit duration is sent back, we will use that as the retry-after
    // header value to let the client know when it will be best to try again
    res.header('Retry-After', rateLimitDuration.as('seconds').toString());
    res.status(429).json({ error: true, message: 'rate limit exceeded' });
    return;
  }

  // Rate limit was not hit, proceed
  return next();
}
