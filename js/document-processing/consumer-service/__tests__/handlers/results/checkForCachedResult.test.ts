/* eslint-disable @typescript-eslint/unbound-method */
import type { PrismaClient } from '@prisma/client';
import { checkForCachedResult } from '../../../src/handlers/results/checkForCachedResult';
import { Logger, getLogger } from '../../../src/utils/logger';

describe('checkForCachedResult', () => {
  let logger: Logger;
  beforeAll(() => {
    logger = new Logger({
      logLevel: 'debug',
    });

    getLogger(logger);
  });

  let prisma: PrismaClient;
  beforeEach(() => {
    getLogger(logger);
    prisma = {
      documentProcessResult: {
        findFirst: jest.fn(() => ({
          id: 1,
        })),
      },
      jobToDocumentProcessResult: {
        create: jest.fn(),
      },
    } as any;
  });

  test('finds cached result', async () => {
    const result = await checkForCachedResult(prisma, logger, {
      jobId: '',
      documentId: '',
      jobType: 'ping',
    });
    expect(result).toBe(true);
    expect(prisma.documentProcessResult.findFirst).toHaveBeenCalled();
    expect(prisma.jobToDocumentProcessResult.create).toHaveBeenCalled();
  });
  test('does not find cached result', async () => {
    const result = await checkForCachedResult(
      {
        ...prisma,
        documentProcessResult: { findFirst: () => undefined },
      } as any,
      logger,
      {
        jobId: '',
        documentId: '',
        jobType: 'ping',
      }
    );
    expect(result).toBe(false);
    expect(prisma.jobToDocumentProcessResult.create).not.toHaveBeenCalled();
  });
});
