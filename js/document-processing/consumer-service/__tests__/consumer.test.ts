import { handleJob } from '../src/consumer';
import { lambdaClient } from '../src/service/lambdaService';
import { Logger, getLogger } from '../src/utils/logger';

jest.mock('zeromq', () => {
  return {
    socket: jest.fn(() => ({
      bindSync: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
    })),
  };
});

describe('consumer', () => {
  describe('handleJob', () => {
    let logger: Logger;
    beforeAll(() => {
      logger = new Logger({
        logLevel: 'debug',
      });

      getLogger(logger);
      lambdaClient(
        {
          pdfPreprocessLambda: 'pdfPreprocessLambda',
          jobResponseLambda: 'jobResponseLambda',
        },
        logger
      );
    });

    let errorSpy: jest.SpyInstance;
    beforeEach(() => {
      getLogger(logger);
      errorSpy = jest.spyOn(logger, 'error');
    });

    test('should handle ping event', async () => {
      const result = await handleJob({
        event: 'ping',
        jobId: '123',
        data: { test: true },
      });
      expect(result).toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
