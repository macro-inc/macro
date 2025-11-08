import { validateResponseEvent } from '../src/producer';

describe('producer', () => {
  describe('validateResponseEvent', () => {
    test('validates', () => {
      expect(
        validateResponseEvent('ping', {
          jobId: '123',
          jobType: 'ping',
          data: { pong: true },
          error: false,
          message: 'success',
        })
      ).toBe(true);
    });
    test('returns false if response is not valid', () => {
      try {
        validateResponseEvent('pdf_preprocess', {
          resultUrl: 'bad',
        });
        throw new Error('did not throw');
      } catch (err) {
        expect((err as any).format()).toEqual({
          _errors: [],
          jobId: {
            _errors: ['Required'],
          },
          jobType: {
            _errors: ['Required'],
          },
        });
      }
    });

    test('throws on invalid event', () => {
      expect(() => {
        validateResponseEvent('random' as any, {
          jobId: '123',
          jobType: 'random',
          data: { test: true },
          error: false,
        });
      }).toThrow('event random not supported');
    });
  });
});
