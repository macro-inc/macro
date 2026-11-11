# Configured native class metadata

`registrations` consumes the actual prepared registered-node map, pairing each
captured type name with its configured constructor. It does not add canonical
classes to the public allowlist or reread static `getType`/`Function.name` for
registration. Native class names are empty diagnostic labels, never identity.

Native storage/prototype selection uses exact known baseline function identity.
The supported descriptors are core Root/Text/Tab/Paragraph/LineBreak and the
explicit generic Element baseline. A generic Element named `heading` stays
generic; a type-name string does not identify the canonical Heading constructor.
Unsupported codecs and nonempty storage/type-name mismatches reject instead of
silently selecting a different payload or Paragraph behavior.

`constructorToken` is one module-owned weak function-identity allocator, shared
across editor metadata. It never reads constructor properties, reuses a token
for the same live function, and never reissues numeric tokens. It grants no
constructor, import, clone, hydration or graph authority.

Preserve actual override masks, including Artificial's prepared static
`importJSON` factory. Generic storage does not enable that hook. Native handlers
must explicitly support each advertised bit before construction can proceed.
The returned class/function and payload maps support future exact-instance
lookup; they are not a hydration fallback. Resolve source owner/class/instance
identity and the real scope before constructing or rebinding any object.

The component tests prepare actual JS classes and check generated metadata.
They do not initialize the native hosted factory, invoke native constructors,
or establish a production initializer or full Macro acceptance.
