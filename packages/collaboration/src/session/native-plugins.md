# Session plugin ownership

`native-plugins.ts` stores one immutable ownership manifest per opaque editor
identity. The default is an empty list: JavaScript owns every plugin. Compatibility
editor construction copies the list once and passes that exact list to the native
configuration. The native factory must install each selected policy and its
transforms, or reject construction. Metadata alone is not an installer.

An entry uses the generated `CompatNativePluginConfig` union. The initial
MarkdownShortcuts entry carries ordered `typing` and `enter` transformer IDs;
there is no implicit full preset. `nativeShortcutTransformerId(name)` converts
names from the plugin-local, source-generated object identity lookup. Unknown
names, numeric zero and duplicate plugin owners reject before publishing metadata.
The options and arrays are copied and frozen. Same-editor getter/iterator reentry
cannot replace a manifest, and failed validation permits a fresh construction.

Plugin adapters use `hasNativePlugin(editor, NativePluginId.MarkdownShortcuts)`
to skip the selected JavaScript logic while retaining its UI. Every JavaScript
logic registration entry calls `assertJSPluginRegistration` before registering
handlers or transforms. This catches native-plus-JavaScript ownership at the
adapter boundary; it does not infer ownership from arbitrary callback identities.
These queries use object identity only, so unchanged upstream editors require no
compatibility class cast and retain JavaScript ownership.

The wire IDs come from the source-generated Rust `ShortcutTransformerId` order,
starting at one; zero is reserved and rejected. Do not maintain a second mapping.
Generate in this order after changing the catalog:

```sh
bun scripts/generate-compat-native-plugins.ts --schema-only
bun scripts/generate-compatibility-schema.ts
bun scripts/generate-compat-native-plugins.ts
```

The final step reads the compiler's actual enum symbols by numeric ID, including
acronym normalization. Both generators support `--check` without changing source
outputs. The converter formatter is pinned to the package configuration and
absolute generated path, independently of the invoking directory.

Native plugin installation, rollback, application behavior comparisons and the
production initializer remain separate gates. Keep every ownership list empty
until the selected policy has real source-matched OFF/ON evidence.
