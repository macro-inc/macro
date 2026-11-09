import {
  getStaticNodeConfig as getOriginalStaticNodeConfig,
  TextNode as OriginalTextNode,
} from 'lexical';
import { expect, test } from 'vitest';
import { TextNode } from '../text';
import { getStaticNodeConfig } from './prepare';

test('default constructor checks preserve Original length getter evaluation order', () => {
  const originalEvents: string[] = [];
  const actualEvents: string[] = [];
  class OriginalPrepared extends OriginalTextNode {
    $config() {
      originalEvents.push('config');
      return this.config('length-order', { extends: OriginalTextNode });
    }
  }
  class ActualPrepared extends TextNode {
    $config() {
      actualEvents.push('config');
      return this.config('length-order', { extends: TextNode });
    }
  }
  Object.defineProperty(OriginalPrepared, 'length', {
    get() {
      originalEvents.push('length');
      return 0;
    },
  });
  Object.defineProperty(ActualPrepared, 'length', {
    get() {
      actualEvents.push('length');
      return 0;
    },
  });
  getOriginalStaticNodeConfig(OriginalPrepared);
  getStaticNodeConfig(ActualPrepared);
  expect(originalEvents).toEqual(['config', 'length', 'length']);
  expect(actualEvents).toEqual(originalEvents);
});

test('required constructor diagnostics match Original before factory installation', () => {
  const OriginalRequired = class Required extends OriginalTextNode {
    constructor(value: string) {
      super(value.trim());
    }
    $config() {
      return this.config('required-order', { extends: OriginalTextNode });
    }
  };
  const ActualRequired = class Required extends TextNode {
    constructor(value: string) {
      super(value.trim());
    }
    $config() {
      return this.config('required-order', { extends: TextNode });
    }
  };
  let originalMessage: string | undefined;
  try {
    getOriginalStaticNodeConfig(OriginalRequired);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    originalMessage = error.message;
  }
  if (originalMessage === undefined)
    throw new Error('expected Original constructor rejection');
  expect(() => getStaticNodeConfig(ActualRequired)).toThrow(originalMessage);
  expect(Object.hasOwn(ActualRequired, 'getType')).toBe(true);
  expect(Object.hasOwn(ActualRequired, 'clone')).toBe(false);
  expect(Object.hasOwn(ActualRequired, 'importJSON')).toBe(false);
});
