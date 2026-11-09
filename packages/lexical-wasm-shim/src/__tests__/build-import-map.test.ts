// @vitest-environment jsdom
import { buildImportMap as original } from 'lexical';
import { expect, test } from 'vitest';
import { buildImportMap } from '../nodes/build-import-map';

test('tag map widening preserves exact identity, lazy getters and receiver', () => {
  const events: unknown[] = [];
  const map = {
    get input() {
      events.push('get');
      return (node: HTMLInputElement) => {
        events.push(node.value);
        return { conversion: () => null };
      };
    },
  };
  expect(buildImportMap(map)).toBe(map);
  expect(original(map)).toBe(map);
  expect(events).toEqual([]);
  const input = document.createElement('input');
  input.value = 'actual';
  buildImportMap(map).input(input);
  original(map).input(input);
  expect(events).toEqual(['get', 'actual', 'get', 'actual']);
});
