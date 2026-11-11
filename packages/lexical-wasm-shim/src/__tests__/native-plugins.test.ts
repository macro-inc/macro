import { CompatNativePluginConfig } from '@macro-inc/collaboration/session/compatibility.generated';
import {
  assertJSPluginRegistration,
  getNativePluginManifest,
  hasNativePlugin,
  NativePluginId,
} from '@macro-inc/collaboration/session/native-plugins';
import { expect, test } from 'vitest';
import { createEditor } from '../index';

test('real editors default to JS ownership and sample the construction manifest once', () => {
  let reads = 0;
  const editor = createEditor({
    get nativePlugins() {
      reads++;
      return [];
    },
  });
  try {
    expect(reads).toBe(1);
    expect(getNativePluginManifest(editor)).toEqual([]);
    expect(hasNativePlugin(editor, NativePluginId.MarkdownShortcuts)).toBe(
      false
    );
    expect(() =>
      assertJSPluginRegistration(editor, NativePluginId.MarkdownShortcuts)
    ).not.toThrow();
    editor.update(() => {}, { discrete: true });
    expect(reads).toBe(1);
  } finally {
    editor.dispose();
  }
});

test('development construction rejects native ownership instead of installing a substitute', () => {
  expect(() =>
    createEditor({
      nativePlugins: [
        CompatNativePluginConfig.fromCompatMarkdownShortcutsPlugin({
          typing: [],
          enter: [],
        }),
      ],
    })
  ).toThrow('Native plugin ownership requires the production session');

  const editor = createEditor();
  try {
    expect(getNativePluginManifest(editor)).toEqual([]);
  } finally {
    editor.dispose();
  }
});
