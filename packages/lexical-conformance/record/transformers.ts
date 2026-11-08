import { namedFunctions, namedTransformers } from './encode';
import type { Recorder } from './membrane';

const patched = new WeakSet<object>();

/** Observe successful stock transformer hooks without replacing transformer identity. */
export function instrumentTransformers(
  module: Record<string, unknown>,
  name: string,
  recorder: () => Recorder | undefined
): void {
  for (const [key, value] of Object.entries(module)) {
    if (
      !value ||
      typeof value !== 'object' ||
      !('type' in value) ||
      !('regExp' in value || 'tag' in value || 'regExpStart' in value)
    )
      continue;
    const id = `${name}.${key}`;
    namedTransformers.set(value, id);
    if (patched.has(value)) continue;
    patched.add(value);
    for (const hook of [
      'replace',
      'export',
      'handleImportAfterStartMatch',
      'getEndIndex',
    ]) {
      const fn = Reflect.get(value, hook);
      if (typeof fn !== 'function') continue;
      Reflect.set(value, hook, function (this: unknown, ...args: unknown[]) {
        const result = Reflect.apply(fn, this, args);
        if (result !== null && result !== false)
          recorder()?.transformersFired.add(id);
        return result;
      });
      namedFunctions.set(Reflect.get(value, hook), `${id}.${hook}`);
    }
    for (const field of ['regExp', 'regExpStart', 'regExpEnd']) {
      const regexp = Reflect.get(value, field);
      if (!(regexp instanceof RegExp)) continue;
      const exec = regexp.exec;
      regexp.exec = function (input: string) {
        const result = Reflect.apply(exec, this, [input]);
        if (result !== null) recorder()?.transformersFired.add(id);
        return result;
      };
    }
  }
}
