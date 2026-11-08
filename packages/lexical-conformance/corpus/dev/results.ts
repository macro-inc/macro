import { isDeepStrictEqual } from 'node:util';
import { object } from './scan';

/** Paired conversion errors are unverified, never evidence of matching semantics. */
export function evaluate(
  ts: unknown,
  rust: unknown,
  decode?: (value: unknown) => unknown,
  exactBytes = false
) {
  if (!object(ts) || !object(rust)) throw new Error('Invalid adapter result');
  let tsError = !Object.hasOwn(ts, 'ok');
  let rustError = !Object.hasOwn(rust, 'ok');
  if (tsError && rustError) return { kind: 'unverified', tsError, rustError };
  let expected = ts.ok;
  let actual = rust.ok;
  if (decode) {
    if (!tsError) {
      try {
        expected = decode(expected);
      } catch {
        tsError = true;
      }
    }
    if (!rustError) {
      try {
        actual = decode(actual);
      } catch {
        rustError = true;
      }
    }
  }
  const equal =
    !tsError &&
    !rustError &&
    isDeepStrictEqual(expected, actual) &&
    (!exactBytes || isDeepStrictEqual(ts.ok, rust.ok));
  return { kind: equal ? 'equal' : 'different', tsError, rustError };
}
