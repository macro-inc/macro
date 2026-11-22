import { format } from 'node:util';
import { isOracleFrame } from './attribution';
import { errorValue, type Op } from './schema';

/** Capture observable logs and reject an otherwise unobserved asynchronous failure. */
export function captureEvents(
  emit: (event: Op) => void,
  reject: (reason: string) => void
): () => void {
  const warn = console.warn;
  const error = console.error;
  const wrap =
    (level: 'warn' | 'error', original: typeof console.warn) =>
    (...args: unknown[]) => {
      if (isOracleFrame())
        emit({
          op: 'log',
          level,
          message: format(
            ...args.map((arg) => (arg instanceof Error ? arg.message : arg))
          ),
        });
      original(...args);
    };
  console.warn = wrap('warn', warn);
  console.error = wrap('error', error);
  const unhandled = (reason: unknown) =>
    reject(`unhandled-rejection: ${errorValue(reason).message}`);
  process.on('unhandledRejection', unhandled);
  return () => {
    console.warn = warn;
    console.error = error;
    process.off('unhandledRejection', unhandled);
  };
}
