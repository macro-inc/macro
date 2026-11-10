# Ordered MagicChip message payload

MagicChip's Source exportComponentProps retains its original promptedMessage
value. Typed MagicChipMessage decoding previously discarded nested key order and
extra fields before native export. The Source cache control in 83a51ed3cd proves
that reversing turn/author ordering changes the actual cached decorator closure.

OrderedMagicChipMessage retains the real raw serde_json::Value, validates with
the existing MagicChipMessage deserializer, and serializes the same raw value.
It does not narrow null/scalar errors or existing sequence admission. The typed
announcement path has no original JSON order witness: from_typed explicitly
serializes its real typed message canonically and propagates errors with ?.
No other announcement fields or import policies change.

Only the raw representation fix and its necessary one-field typed announcement
adapter belong here. Agent/envelope/reply constructors, per-setter counters and
counter APIs remain unchanged. The held counter draft is outside the source
tree: signature-cached classes require comparison with the last actual published
signature, so A-to-B-to-A before observation must retain the Source closure.
Pure signature metadata, native Diff state and actual consuming-view exposure
are separate coordinated work. No local hash, guessed phase or observer API is
introduced here.

Four focused tests pass for raw order/extras, unchanged validator behavior,
canonical typed construction and real native COW/copy/reparent/import paths.
The Loro assertion proves extra-field presence only; it does not prove ordered
JSON roundtrip through Loro maps.
Strict Clippy over all targets of both affected crates and scoped checks pass.
The compositor wire suite is a separate validation gate. This payload checkpoint
does not establish signature observation, mounted native remounts or acceptance
of the full decorator binding.
