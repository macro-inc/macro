import { describe, expect, test } from 'vitest';
import {
  CompatNativePluginConfig,
  CompatShortcutTransformer,
} from './compatibility.generated';
import {
  assertJSPluginRegistration,
  getNativePluginManifest,
  hasNativePlugin,
  installNativePluginManifest,
  NativePluginId,
  nativeShortcutTransformerId,
} from './native-plugins';

// These are opaque identity/metadata tests, not editors, a model or an installer.
describe('session plugin ownership metadata', () => {
  test('getter reentry cannot replace ownership and failed validation releases its reservation', () => {
    const identity = {};
    const owner = CompatNativePluginConfig.fromCompatMarkdownShortcutsPlugin({
      typing: [],
      enter: [],
    });
    const data = owner.data;
    Object.defineProperty(owner, 'data', {
      get() {
        installNativePluginManifest(identity, []);
        return data;
      },
    });
    expect(() => installNativePluginManifest(identity, [owner])).toThrow(
      'being configured'
    );
    expect(getNativePluginManifest(identity)).toEqual([]);
    const valid = CompatNativePluginConfig.fromCompatMarkdownShortcutsPlugin({
      typing: [],
      enter: [],
    });
    expect(installNativePluginManifest(identity, [valid])).toHaveLength(1);
  });

  test('defaults to JS ownership and snapshots ordered native options once', () => {
    const identity = {};
    expect(hasNativePlugin(identity, NativePluginId.MarkdownShortcuts)).toBe(
      false
    );
    expect(() =>
      assertJSPluginRegistration(identity, NativePluginId.MarkdownShortcuts)
    ).not.toThrow();
    const typing = [CompatShortcutTransformer.OrderedListEnter];
    const enter = [
      CompatShortcutTransformer.HR,
      CompatShortcutTransformer.Code,
      CompatShortcutTransformer.OrderedListEnter,
    ];
    const manifest = installNativePluginManifest(identity, [
      CompatNativePluginConfig.fromCompatMarkdownShortcutsPlugin({
        typing,
        enter,
      }),
    ]);
    typing.push(CompatShortcutTransformer.Code);
    enter.reverse();
    expect(manifest).toBe(getNativePluginManifest(identity));
    expect(manifest[0].data.value.typing).toEqual([
      CompatShortcutTransformer.OrderedListEnter,
    ]);
    expect(manifest[0].data.value.enter).toEqual([
      CompatShortcutTransformer.HR,
      CompatShortcutTransformer.Code,
      CompatShortcutTransformer.OrderedListEnter,
    ]);
    expect(Object.isFrozen(manifest[0].data.value.typing)).toBe(true);
    expect(Object.isFrozen(manifest[0].data.value)).toBe(true);
    expect(hasNativePlugin(identity, NativePluginId.MarkdownShortcuts)).toBe(
      true
    );
    expect(() =>
      assertJSPluginRegistration(identity, NativePluginId.MarkdownShortcuts)
    ).toThrow('already owned');
    expect(() => installNativePluginManifest(identity, [])).toThrow(
      'already fixed'
    );
  });

  test('rejects duplicate owners and unknown IDs without installing partial metadata', () => {
    const identity = {};
    const owner = CompatNativePluginConfig.fromCompatMarkdownShortcutsPlugin({
      typing: [],
      enter: [],
    });
    expect(() => installNativePluginManifest(identity, [owner, owner])).toThrow(
      'Duplicate'
    );
    expect(getNativePluginManifest(identity)).toEqual([]);
    expect(() =>
      installNativePluginManifest(identity, [
        CompatNativePluginConfig.fromCompatMarkdownShortcutsPlugin({
          typing: [CompatShortcutTransformer.Unknown],
          enter: [],
        }),
      ])
    ).toThrow('Unknown native shortcut');
    expect(getNativePluginManifest(identity)).toEqual([]);
    expect(() => hasNativePlugin(identity, NativePluginId.Unknown)).toThrow(
      'Unknown native plugin'
    );
    expect(nativeShortcutTransformerId('ORDERED_LIST_ENTER')).toBe(
      CompatShortcutTransformer.OrderedListEnter
    );
    expect(() => nativeShortcutTransformerId('unregistered')).toThrow(
      'Unknown'
    );
  });
});
