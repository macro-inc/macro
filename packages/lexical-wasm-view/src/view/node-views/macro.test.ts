import type { Component } from 'solid-js';
import { expect, test } from 'vitest';
import type { DecoratorProps } from '../registry';
import { createBuiltinRegistry } from './builtins';
import {
  registerMacroDecoratorViews,
  registerMacroElementViews,
  registerMacroViews,
} from './macro';

test('independent plugin groups add decorators without replacing existing group renderers', () => {
  const image: Component<DecoratorProps> = () => null;
  const mention: Component<DecoratorProps> = () => null;
  const registry = registerMacroElementViews(createBuiltinRegistry());
  registerMacroDecoratorViews(registry, { 'user-mention': mention });
  const previous = registry.get('user-mention');
  registerMacroDecoratorViews(registry, { image });
  expect(registry.get('user-mention')).toBe(previous);
  expect(registry.get('image').decorator).toBe(image);
  expect(registry.get('custom-code')).toBe(registry.get('code'));
  expect(registry.has('video')).toBe(false);
  expect(() => registerMacroDecoratorViews(registry, { image })).toThrow(
    'Duplicate node view: image'
  );
});

test('complete Macro registration still rejects a missing concrete decorator', () => {
  expect(() =>
    Reflect.apply(registerMacroViews, undefined, [createBuiltinRegistry(), {}])
  ).toThrow('Missing Macro decorator component: account-manager-request');
});
