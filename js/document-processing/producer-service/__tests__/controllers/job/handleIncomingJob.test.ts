import type { NextFunction, Request, Response } from 'express';
import { handleIncomingJob } from '../../../src/controllers/job/index';

let req: Request;
let res: Response;
let next: NextFunction;

jest.mock('zeromq', () => {
  return {
    socket: jest.fn(() => ({
      bindSync: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
    })),
  };
});

beforeEach(() => {
  req = {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    logger: { info: () => {}, debug: () => {}, error: () => {} },
  } as unknown as Request;
  res = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  } as unknown as Response;
  next = jest.fn() as NextFunction;
});

describe('handleIncomingJob', () => {
  test('successfully queues job', () => {
    req.body = {
      event: 'ping',
      data: {
        test: true,
      },
    };
    handleIncomingJob(req as any, res, next);

    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
