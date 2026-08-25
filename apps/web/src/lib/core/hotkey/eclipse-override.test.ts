import { createRoot } from 'solid-js';
import { afterEach, describe, expect, test } from 'vitest';
import { registerHotkey } from './hotkeys';
import { hotkeyScopeTree, hotkeyTokenMap } from './state';
import type { HotkeyToken } from './tokens';
import type { ValidHotkey } from './types';
import { getCommandsForHotkey, registerScope, removeScope } from './utils';

let scopeCounter = 0;
const createdScopes: string[] = [];

function makeScope(): string {
  const scopeId = `eclipse-test-scope-${scopeCounter++}`;
  registerScope({ parentScopeId: 'global', scopeId, type: 'dom' });
  createdScopes.push(scopeId);
  return scopeId;
}

afterEach(() => {
  for (const scopeId of createdScopes) {
    if (hotkeyScopeTree.has(scopeId)) removeScope(scopeId);
  }
  createdScopes.length = 0;
});

/** The registered commands for a key, in registration order, eclipsed included. */
function rawCommands(scopeId: string, key: ValidHotkey) {
  return (
    hotkeyScopeTree
      .get(scopeId)
      ?.commands.filter((c) => c.hotkeys?.includes(key)) ?? []
  );
}

/** Descriptions of the commands that would currently run for a key. */
function effectiveDescriptions(scopeId: string, key: ValidHotkey): string[] {
  const scopeNode = hotkeyScopeTree.get(scopeId);
  if (!scopeNode) return [];
  return getCommandsForHotkey(scopeNode, key).map(
    (c) => c.description as string
  );
}

function register(
  scopeId: string,
  description: string,
  options: Partial<Parameters<typeof registerHotkey>[0]> = {}
) {
  return registerHotkey({
    scopeId,
    description,
    hotkey: 'x',
    keyDownHandler: () => true,
    ...options,
  });
}

describe('eclipse override', () => {
  test('an override eclipses earlier commands and disposal restores them', () => {
    const scopeId = makeScope();
    const first = register(scopeId, 'first');
    const second = register(scopeId, 'second');

    // Both stay registered; only the newest override is effective.
    expect(rawCommands(scopeId, 'x')).toHaveLength(2);
    expect(effectiveDescriptions(scopeId, 'x')).toEqual(['second']);

    second.dispose();
    expect(effectiveDescriptions(scopeId, 'x')).toEqual(['first']);

    first.dispose();
    expect(rawCommands(scopeId, 'x')).toHaveLength(0);
  });

  test("an 'add' command coexists with an earlier override", () => {
    const scopeId = makeScope();
    const override = register(scopeId, 'override');
    register(scopeId, 'added', { registrationType: 'add' });

    expect(effectiveDescriptions(scopeId, 'x')).toEqual(['override', 'added']);

    override.dispose();
    expect(effectiveDescriptions(scopeId, 'x')).toEqual(['added']);
  });

  test('a later override eclipses earlier override and add together', () => {
    const scopeId = makeScope();
    register(scopeId, 'first');
    register(scopeId, 'added', { registrationType: 'add' });
    const last = register(scopeId, 'last');

    expect(effectiveDescriptions(scopeId, 'x')).toEqual(['last']);

    last.dispose();
    expect(effectiveDescriptions(scopeId, 'x')).toEqual(['first', 'added']);
  });

  test('a same-token override replaces the previous registration instead of stacking', () => {
    const scopeId = makeScope();
    const token = 'eclipse-test:same-token' as HotkeyToken;
    const first = register(scopeId, 'first', { hotkeyToken: token });
    register(scopeId, 'second', { hotkeyToken: token });

    expect(rawCommands(scopeId, 'x')).toHaveLength(1);
    expect(effectiveDescriptions(scopeId, 'x')).toEqual(['second']);
    expect(hotkeyTokenMap().get(token)).toHaveLength(1);

    // Disposing the replaced registration must not disturb the replacement.
    first.dispose();
    expect(effectiveDescriptions(scopeId, 'x')).toEqual(['second']);
    expect(hotkeyTokenMap().get(token)).toHaveLength(1);
  });

  test('a same-token override replaces a previous unkeyed registration', () => {
    const scopeId = makeScope();
    const token = 'eclipse-test:unkeyed-token' as HotkeyToken;
    register(scopeId, 'first', { hotkey: undefined, hotkeyToken: token });
    register(scopeId, 'second', { hotkey: undefined, hotkeyToken: token });

    const unkeyed =
      hotkeyScopeTree.get(scopeId)?.commands.filter((c) => !c.hotkeys) ?? [];
    expect(unkeyed.map((c) => c.description)).toEqual(['second']);
    expect(hotkeyTokenMap().get(token)).toHaveLength(1);
  });
});

describe('owner-bound disposal', () => {
  test('registrations dispose with their reactive owner unless opted out', () => {
    const scopeId = makeScope();
    const dispose = createRoot((disposeRoot) => {
      register(scopeId, 'owned');
      register(scopeId, 'persistent', {
        hotkey: 'y',
        disposeWithOwner: false,
      });
      return disposeRoot;
    });

    expect(effectiveDescriptions(scopeId, 'x')).toEqual(['owned']);
    expect(effectiveDescriptions(scopeId, 'y')).toEqual(['persistent']);

    dispose();
    expect(rawCommands(scopeId, 'x')).toHaveLength(0);
    expect(effectiveDescriptions(scopeId, 'y')).toEqual(['persistent']);
  });
});
