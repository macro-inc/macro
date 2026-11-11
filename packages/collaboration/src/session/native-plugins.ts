import {
  CompatNativePlugin,
  CompatNativePluginConfig,
  CompatShortcutTransformer,
  type ICompatNativePluginConfig,
} from './compatibility.generated';

export { CompatNativePlugin as NativePluginId } from './compatibility.generated';
export { nativeShortcutTransformerId } from './compatibility-native-plugins.generated';
export type NativePluginManifest = readonly ICompatNativePluginConfig[];

const empty: NativePluginManifest = Object.freeze([]);
// The key is only an editor identity, so unchanged upstream editors also use
// this query without importing the compatibility core's recursive class types.
const manifests = new WeakMap<object, NativePluginManifest>();
const installing = new WeakSet<object>();
const pluginIds = new Set<number>(
  Object.values(CompatNativePlugin).filter(
    (value) => typeof value === 'number' && value !== 0
  )
);
const transformerIds = new Set<number>(
  Object.values(CompatShortcutTransformer).filter(
    (value) => typeof value === 'number' && value !== 0
  )
);

function validatePluginId(id: CompatNativePlugin): void {
  if (!Number.isInteger(id) || !pluginIds.has(id))
    throw new Error('Unknown native plugin owner');
}

function copyTransformers(
  values: readonly CompatShortcutTransformer[]
): CompatShortcutTransformer[] {
  if (!Array.isArray(values))
    throw new Error('Expected ordered native transformer IDs');
  const copy = [...values];
  for (const value of copy) {
    if (!Number.isInteger(value) || !transformerIds.has(value))
      throw new Error('Unknown native shortcut transformer');
  }
  Object.freeze(copy);
  return copy;
}

/** Construction only: the backend must install this exact list or reject it. */
export function installNativePluginManifest(
  editor: object,
  plugins: NativePluginManifest
): NativePluginManifest {
  if (manifests.has(editor) || installing.has(editor))
    throw new Error(
      'Native plugin ownership is already fixed or being configured'
    );
  installing.add(editor);
  try {
    if (!Array.isArray(plugins))
      throw new Error('Expected a native plugin ownership list');
    const seen = new Set<number>();
    const snapshot: ICompatNativePluginConfig[] = [];
    for (const plugin of plugins) {
      const data = plugin.data;
      validatePluginId(data.discriminator);
      if (seen.has(data.discriminator))
        throw new Error('Duplicate native plugin owner');
      seen.add(data.discriminator);
      if (data.discriminator !== CompatNativePlugin.MarkdownShortcuts)
        throw new Error('Unsupported native plugin configuration');
      const value = data.value;
      const configuration =
        CompatNativePluginConfig.fromCompatMarkdownShortcutsPlugin({
          typing: copyTransformers(value.typing),
          enter: copyTransformers(value.enter),
        });
      Object.freeze(configuration.data.value);
      Object.freeze(configuration.data);
      Object.freeze(configuration);
      snapshot.push(configuration);
    }
    Object.freeze(snapshot);
    manifests.set(editor, snapshot);
    return snapshot;
  } finally {
    installing.delete(editor);
  }
}

export function getNativePluginManifest(editor: object): NativePluginManifest {
  return manifests.get(editor) ?? empty;
}

export function hasNativePlugin(
  editor: object,
  id: CompatNativePlugin
): boolean {
  validatePluginId(id);
  return getNativePluginManifest(editor).some(
    (entry) => entry.data.discriminator === id
  );
}

/** Call before registering JS logic; a selected native owner must never run twice. */
export function assertJSPluginRegistration(
  editor: object,
  id: CompatNativePlugin
): void {
  if (hasNativePlugin(editor, id))
    throw new Error('Plugin logic is already owned by the native session');
}
