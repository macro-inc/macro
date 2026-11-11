import { expect, test } from 'vitest';
import { DequeSet } from '../../command/deque-set';
import type { CommandBucket, CommandRegistry } from '../../command/types';
import { type CommandListener, createCommand } from '../../commands';
import { commandBucket } from '../../compatibility-exceptions';
import { createEditor } from '../../editor';

function emptyBucket(): CommandBucket<unknown> {
  return [
    new DequeSet(),
    new DequeSet(),
    new DequeSet(),
    new DequeSet(),
    new DequeSet(),
  ];
}

test('command bucket association follows exact command identity and typed payloads', () => {
  const editor = createEditor({
    namespace: 'command association',
    onError: (error) => {
      throw error;
    },
  });
  try {
    const numbers = createCommand<number>('same label');
    const strings = createCommand<string>('same label');
    const registry: CommandRegistry = new Map();
    registry.set(numbers, emptyBucket());
    registry.set(strings, emptyBucket());
    const values: unknown[] = [];
    const numeric = commandBucket(registry, numbers);
    const textual = commandBucket(registry, strings);
    numeric[2].addBack((value) => {
      values.push(value + 1);
      return false;
    });
    textual[2].addBack((value) => {
      values.push(value.toUpperCase());
      return false;
    });
    for (const listener of numeric[2]) listener(41, editor);
    for (const listener of textual[2]) listener('text', editor);
    expect(values).toEqual([42, 'TEXT']);
    expect(numeric).toBe(registry.get(numbers));
    expect(textual).toBe(registry.get(strings));
    expect(numeric).not.toBe(textual);
  } finally {
    editor.dispose();
  }
});

test('command bucket lookup rejects missing and malformed priority groups', () => {
  const command = createCommand<number>('missing');
  const registry: CommandRegistry = new Map();
  expect(() => commandBucket(registry, command)).toThrow('not registered');
  const malformed = new Map<object, unknown>([[command, []]]);
  expect(() =>
    Reflect.apply(commandBucket, undefined, [malformed, command])
  ).toThrow('five DequeSet');
  const sparse = new Map<object, unknown>([[command, new Array(5)]]);
  expect(() =>
    Reflect.apply(commandBucket, undefined, [sparse, command])
  ).toThrow('five DequeSet');
  const listener: CommandListener<unknown> = () => false;
  const wrongKind = new Map<object, unknown>([
    [
      command,
      [new Set([listener]), new Set(), new Set(), new Set(), new Set()],
    ],
  ]);
  expect(() =>
    Reflect.apply(commandBucket, undefined, [wrongKind, command])
  ).toThrow('five DequeSet');
});
