import {
  configExtension as configureOriginal,
  defineExtension as defineOriginal,
  safeCast as identityOriginal,
  shallowMergeConfig as mergeOriginal,
  declarePeerDependency as peerOriginal,
} from 'lexical';
import { expect, test } from 'vitest';
import {
  configExtension,
  declarePeerDependency,
  defineExtension,
} from './defineExtension';
import { safeCast } from './safeCast';
import { shallowMergeConfig } from './shallowMergeConfig';

test('inference helpers do not evaluate extension properties and preserve user objects', () => {
  const opaque = { reason: 'deferred extension name' };
  let reads = 0;
  const deferred = {
    get name(): string {
      reads++;
      throw opaque;
    },
  };
  expect(defineExtension(deferred)).toBe(deferred);
  expect(defineOriginal(deferred)).toBe(deferred);
  expect(reads).toBe(0);
  const config = { required: 1 };
  expect(safeCast(config)).toBe(config);
  expect(identityOriginal(config)).toBe(config);
  const actual = defineExtension({ name: 'number', config });
  const original = defineOriginal({ name: 'number', config });
  const override = { required: 2 };
  const actualArgs = configExtension(actual, override);
  const originalArgs = configureOriginal(original, override);
  expect(actualArgs[0]).toBe(actual);
  expect(originalArgs[0]).toBe(original);
  expect(actualArgs[1]).toBe(override);
  expect(originalArgs[1]).toBe(override);
  const actualPeer = declarePeerDependency<typeof actual>('number', override);
  const originalPeer = peerOriginal<typeof original>('number', override);
  expect(actualPeer).toEqual(originalPeer);
  expect(actualPeer[1]).toBe(override);
  expect(Reflect.ownKeys(actualPeer)).toEqual(Reflect.ownKeys(originalPeer));
});

test('shallow config merge preserves inherited-key and getter observations', () => {
  class Overrides {
    declare required: number;
  }
  Object.defineProperty(Overrides.prototype, 'required', {
    value: 2,
    enumerable: true,
  });
  const overrides = new Overrides();
  const config = { required: 1 };
  const actualInherited = shallowMergeConfig(config, overrides);
  const originalInherited = mergeOriginal(config, overrides);
  expect(actualInherited).toEqual(originalInherited);
  expect(actualInherited).not.toBe(config);
  expect(originalInherited).not.toBe(config);
  expect(shallowMergeConfig(config, { required: 1 })).toBe(config);
  expect(mergeOriginal(config, { required: 1 })).toBe(config);
  let actualReads = 0;
  let originalReads = 0;
  const actual = {
    get required() {
      actualReads++;
      return 1;
    },
  };
  const original = {
    get required() {
      originalReads++;
      return 1;
    },
  };
  expect(shallowMergeConfig(actual, { required: 2 })).toEqual(
    mergeOriginal(original, { required: 2 })
  );
  expect(actualReads).toBe(originalReads);
  const opaque = { reason: 'config getter' };
  const throwing = {
    get required(): number {
      throw opaque;
    },
  };
  let actualError: unknown;
  let originalError: unknown;
  try {
    shallowMergeConfig(config, throwing);
  } catch (error) {
    actualError = error;
  }
  try {
    mergeOriginal(config, throwing);
  } catch (error) {
    originalError = error;
  }
  expect(actualError).toBe(opaque);
  expect(originalError).toBe(opaque);
});
