export function invariant(
  condition: unknown,
  message: string,
  ...args: unknown[]
): asserts condition {
  if (!condition) {
    let index = 0;
    throw new Error(message.replace(/%s/g, () => String(args[index++])));
  }
}
export function warnOnlyOnce(message: string): () => void {
  let warned = false;
  return () => {
    if (process.env.NODE_ENV !== 'production' && !warned) {
      warned = true;
      console.warn(message);
    }
  };
}
export { cloneMap } from './gen-map';
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/** @internal */
export function normalizeClassNames(
  ...classNames: Array<typeof undefined | boolean | null | string>
): Array<string> {
  const rval = [];
  for (const className of classNames) {
    if (className && typeof className === 'string') {
      for (const [s] of className.matchAll(/\S+/g)) {
        rval.push(s);
      }
    }
  }
  return rval;
}
