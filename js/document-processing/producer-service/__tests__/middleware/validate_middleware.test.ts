import type { NextFunction, Request, Response } from 'express';
import { validateRequestHandler } from '../../src/middleware';

let req: Request;
let res: Response;
let next: NextFunction;

beforeEach(() => {
  req = {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    logger: { info: () => {}, debug: () => {}, error: () => {} },
  } as unknown as Request;
  res = {
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  } as unknown as Response;
  next = jest.fn() as NextFunction;
});

describe('validateRequestHandler', () => {
  test('valid request', () => {
    req.body = {
      event: 'ping',
      jobId: 'test',
      data: {
        test: true,
      },
    };
    validateRequestHandler(req as any, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('correctly validates job missing field', () => {
    req.body = {
      event: 'pdf_password_encrypt',
      jobId: 'test',
      data: {
        documentId: 'test',
        password: 'test',
      },
    };
    validateRequestHandler(req as any, res, next);
    expect(res.send).toHaveBeenCalledWith({
      _errors: [],
      documentVersionId: {
        _errors: ['Required'],
      },
    });
  });

  test('correctly validates job incorrect type', () => {
    req.body = {
      event: 'pdf_password_encrypt',
      jobId: 'test',
      data: {
        documentId: 213,
        documentVersionId: 123,
        password: 'hello',
      },
    };
    validateRequestHandler(req as any, res, next);

    expect(res.send).toHaveBeenCalledWith({
      _errors: [],
      documentId: {
        _errors: ['Expected string, received number'],
      },
    });
  });

  test('handles no body', () => {
    validateRequestHandler(req as any, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: true,
      message: 'invalid request',
    });
  });

  test('handles no event', () => {
    req.body = {
      data: {
        test: true,
      },
    };
    validateRequestHandler(req as any, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: true,
      message: 'missing event|data|jobId',
    });
  });

  test('handles no data', () => {
    req.body = {
      event: 'ping',
    };
    validateRequestHandler(req as any, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: true,
      message: 'missing event|data|jobId',
    });
  });
});
