# JS command dispatch

Keep arbitrary command payloads in JS and preserve command object identity.
Use the centralized commandBucket helper only through registry.ts lookup;
retain the five priority queues, deque snapshot iteration, and parent delegation.
Do not route arbitrary command values through the native opaque codec.

## Checks

Run the actual editor command tests and the pinned upstream comparison, strict
shim check, and scoped just check. Keep closed native event decoders separate
from this generic listener association.
