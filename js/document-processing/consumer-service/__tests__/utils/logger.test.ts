import { Logger } from '../../src/utils/logger';

describe('Logger', () => {
  const logger = new Logger({});

  test('The loggers level can be updated', () => {
    expect(logger.logLevel).toEqual('debug');
  });
  test('The logger can log debug', () => {
    const spy = jest.spyOn(logger, 'debug');

    logger.debug('test message');

    expect(spy).toHaveBeenCalled();
  });
  test('The logger can log info', () => {
    const spy = jest.spyOn(logger, 'info');

    logger.info('test message');

    expect(spy).toHaveBeenCalled();
  });
  test('The logger can log warn', () => {
    const spy = jest.spyOn(logger, 'warn');

    logger.warn('test message');

    expect(spy).toHaveBeenCalled();
  });
  test('The logger can log error', () => {
    const spy = jest.spyOn(logger, 'error');

    logger.error('test message');

    expect(spy).toHaveBeenCalled();
  });
  test('The logger can log fatal', () => {
    const spy = jest.spyOn(logger, 'fatal');

    logger.fatal('test message');

    expect(spy).toHaveBeenCalled();
  });
});
