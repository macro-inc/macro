import { withAnalytics } from './segment';

const { track, TrackingEvents } = withAnalytics();

function serializeError({ name, stack, message }: Error) {
  return {
    name,
    stack,
    message,
  };
}

interface CoparseLogger {
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
}

interface OverwriteConfig {
  trackingOnError: boolean;
  trackingOnWarn: boolean;
  sendToLogger: boolean;
}

export function overwriteLogs({
  logger,
  source,
  config = { trackingOnError: true, trackingOnWarn: false, sendToLogger: true },
}: {
  logger?: CoparseLogger;
  source?: string;
  config?: OverwriteConfig;
}) {
  const target = window;
  console.log('overwriting logs for', source, 'with config', config);
  target.console = new Proxy(console, {
    get: function (target, prop) {
      return (...data: any[]) => {
        let serialized = '';
        try {
          serialized = JSON.stringify(data);
        } catch {
          if (logger && config.sendToLogger) {
            logger.log(
              'error',
              JSON.stringify({
                message: 'tried to log an unserializable value',
              })
            );
          }
        }
        switch (prop) {
          case 'log': {
            target.log(...data);
            if (logger && config.sendToLogger) {
              serialized && logger.log('info', serialized);
            }
            return;
          }

          case 'warn': {
            target.warn(...data);
            if (config.trackingOnWarn) {
              track(TrackingEvents.CONSOLE.WARN, {
                details: data.map((d) =>
                  d instanceof Error ? serializeError(d) : d
                ),
                source,
              });
            }
            if (logger && config.sendToLogger) {
              serialized && logger.log('warn', serialized);
            }
            return;
          }

          case 'error': {
            target.error(...data);
            if (config.trackingOnError) {
              track(TrackingEvents.CONSOLE.ERROR, {
                details: data.map((d) =>
                  d instanceof Error ? serializeError(d) : d
                ),
                source,
              });
            }
            if (logger && config.sendToLogger) {
              serialized && logger.log('error', serialized);
            }
            return;
          }

          default: {
            return Reflect.get(target, prop);
          }
        }
      };
    },
  });
  return;
}
