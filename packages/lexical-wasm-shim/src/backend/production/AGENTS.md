# Production node payload and class metadata components

## Scope

Keep node-payload.ts a pure raw-field projection into generated protocol types.
Require a closed explicit native descriptor; never infer authorization from a
node type name. Actual native class/token/prototype authorization is owned by
the runtime before calling this helper.

Consume prepared configured rows through registrations.ts without adding hidden
native baselines to the public allowlist or rereading getType/Function.name.
Select codecs by actual baseline function identity; preserve unsupported-codec
errors and all advertised hook bits. Share constructor-identity.ts with the host;
its weak function tokens grant no construction or graph authority.

Capture complete Text/Element scalar fields from actual instances, preserving
UTF-16 code units and raw mode values including 3. Validate HeadingNodeTag using
the generated field ID and primitive h1..h6 tags. Generic Element nativeType is
only the empty string. Never serialize JS own fields, Root caches or whole JSON.
Let opaque getter failures propagate unchanged.

## Checks

Run strict package checking, ordinary declarations, real-node payload tests and
scoped just check. Pure payload proof does not authorize seeds, clones or native
field acceptance. Keep native mode/constructor capability gaps explicit.
