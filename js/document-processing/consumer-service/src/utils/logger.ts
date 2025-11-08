import {
  type Logger as WinstonLogger,
  createLogger,
  format,
  transports,
} from 'winston';
const { combine, timestamp, prettyPrint, json } = format;

export class Logger {
  private service: string;
  logLevel: string;
  private logger: WinstonLogger;
  constructor({
    service,
    logLevel,
    defaultMeta,
  }: {
    service?: string;
    logLevel?: string;
    defaultMeta?: { [name: string]: string };
  }) {
    this.service = service ?? `${process.env.SERVICE_NAME}`;
    this.logLevel = logLevel || 'debug';
    this.logger = createLogger({
      level: this.logLevel,
      format: combine(
        timestamp(),
        process.env.ENVIRONMENT === undefined ? prettyPrint() : json()
      ),
      transports: [new transports.Console()],
      silent: process.env.NODE_ENV === 'TEST', // used to silence unit testing
      defaultMeta: {
        ...defaultMeta,
        env: process.env.ENVIRONMENT ?? 'local',
        service: this.service,
      },
    });
  }

  debug(message: string, metadata?: { [name: string]: any }) {
    this.logger.log({ level: 'debug', message, metadata: { ...metadata } });
  }

  info(message: string, metadata?: { [name: string]: any }) {
    this.logger.log({ level: 'info', message, metadata: { ...metadata } });
  }

  warn(message: string, metadata?: { [name: string]: any }) {
    this.logger.log({ level: 'warn', message, metadata: { ...metadata } });
  }

  error(message: string, metadata?: { [name: string]: any }) {
    this.logger.log({ level: 'error', message, metadata: { ...metadata } });
  }

  fatal(message: string, metadata?: { [name: string]: any }) {
    this.logger.log({ level: 'fatal', message, metadata: { ...metadata } });
  }
}

let _logger: Logger;

export function getLogger(l?: Logger) {
  if (!_logger) {
    if (!l) {
      throw new Error('logger not provided');
    }
    _logger = l;
  }
  return _logger;
}
