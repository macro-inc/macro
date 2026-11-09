# Public extension core

Keep all recursive extension callbacks, configuration and state types on the actual
editor/state graph. Preserve pinned generic constraints and inference helpers;
do not substitute unconstrained identities or Original editor aliases.

Import public wildcard aliases only from compatibility-exceptions.ts at pinned
source positions. That single approved type-level entry owns nine AnyKeyword
nodes in four aliases; never use it to erase runtime payloads or add assertions.
The eight runtime assertion helpers remain unchanged.

Forward canonical generic phantom markers type-only, since they bind no fixed
core class. Derive only the canonical peer symbol key from Original public types;
map its optional readonly phantom value to the actual extension. Preserve ordinary
keyof/phantom inference controls. No private-subpath or Original runtime import.

## Checks

Run pure.config.mts tests, strict package types/hooks, ordinary declaration
emission, cold import and scoped just check. contract.type-test.ts must preserve
concrete number config/output and reject the same invalid config as Original.
These source helpers do not construct an editor or activate a native runtime.
