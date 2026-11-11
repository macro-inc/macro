# Foreign class metadata

`NativeNodeCatalog` snapshots native methods before patches. Its nearest baseline
lookup follows actual constructor identity and inheritance, never a serialized
type name. The optional captured name passed to `nearest` only supplies failure
diagnostics; it does not select or authorize a class.

Use `ForeignClassRegistry.fromConfigured(catalog, rows)` for the already prepared
editor map. Each row contains the actual `klass` and its captured nonempty `type`.
This path never reads `getType`, including failures, refreshes and update starts.
It rejects repeated configured classes and types. A configured class may reuse a
hidden catalog class's serialized name, such as a SameNameText override.

Only supplied rows become registrations. Foreign ancestry and `extends` contain
only supplied constructors that actually occur in that class's parent chain.
Hidden catalog baselines do not become foreign ancestors or implicit registered
classes, even when their name equals the configured row's own name. For example,
a configured Tab does not implicitly register its hidden canonical Text parent.

Native baseline selection remains independent from foreign ancestry: a hidden
catalog parent may still be the nearest native baseline. A generic Element named
`heading` does not acquire a different catalog class's native payload by name.
Preserve the selected baseline, hook masks, dynamic accessors and prototype traps.
The generated hook inventory excludes clone staging; this metadata API does not
bind clone, constructor, hydration, callback or native payload authority.

Configured masks inspect hook descriptors without evaluating user accessors on
prototypes. Eligible accessors are virtual even if they would return the native
function; only actual dispatch may resolve their value on the real receiver.
Registry-owned getter/setter pairs are recognized by identity and inspected
through their existing trap state, continuing up the parent chain for an
unwritten inherited slot. Replacing a registry getter with a user accessor does
not make that accessor safe to invoke during metadata preparation or refresh.

The existing constructor remains the legacy path. It still discovers type names,
deduplicates repeated classes, checks catalog-name collisions, and includes
catalog names in ancestry. Do not change it to prepared-map semantics implicitly.
Its existing method-getter evaluation also remains unchanged.

## Checks

Run `src/foreign/configured-registry.config.mts` with the package-pinned Vitest for
engine-free metadata controls over actual node classes. Run the existing
`src/__tests__/registry.test.ts` through the normal package configuration so the
legacy controls validate hook order against the actual conformance WASM. Also run
the strict package/hook check, ordinary declaration emission and scoped checks.
Metadata results are not constructor or production initializer acceptance.
