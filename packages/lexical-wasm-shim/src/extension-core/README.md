# Extension source over the actual editor graph

The pinned public extension interfaces use actual CreateEditorArgs, EditorState
and LexicalEditor throughout initial configuration, dependencies and callbacks.
The editor prerequisite supplies real HTML overrides and editable behavior; this
module supplies no alternate editor or declaration-only configuration fields.

The inference helper signatures retain all four generic parameters and their
pinned constraints. Their bodies preserve identity and source tuple/merge behavior.
The peer tuple is contextually typed without the upstream assertion. safeCast is
the exact pinned identity API, not a substitute for the constrained extension API.

Four public wildcard aliases live only in compatibility-exceptions.ts. They have
exact upstream right-hand sides and nine type-level any keywords (3+0+3+3).
They constitute one approved type-only entry; the eight runtime assertions are
unchanged. No implementation uses these aliases to cross a runtime boundary.

Canonical generic phantom fields and their public marker symbols are type-only
forwards with no fixed core graph. The peer key is extracted from Original's
public normalized tuple using symbol keys alone, excluding array symbol keys.
Its mapped phantom value references the actual extension. Concrete config/output,
bidirectional key identity and phantom inference are checked by ordinary TS6.

Pure Original controls verify deferred getters, object/tuple identity, absence of
runtime phantom properties, inherited overrides, getter ordering and opaque errors.
No native initialization or extension registration lifecycle is implemented here.
