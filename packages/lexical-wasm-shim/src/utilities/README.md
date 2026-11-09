# Pure public utility producers

This module supplies 25 pinned public function bindings without an engine or a
node/editor traversal subset. The root explicitly forwards the pinned public
subset and retains these exact producer bindings.

Existing view producers supply DOM node predicates, owner-document/selection/text
readers, keyboard matching and class-name normalization. New source bodies provide
three HTML tag predicates, inline/block DOM predicates, unmanaged DOM markers,
class-list add/remove, propagation marking, cleanup merging and text direction.
The existing actual format helper is forwarded under `toggleTextFormatType`.
No Original runtime value is imported by product files.

DOM private markers use the pinned data-only fields, with no editor/node class
reference. Propagation marking assigns the original property directly through an
optional-property local type; custom setters, opaque failures and descriptors
remain observable. Inline/block predicates retain canonical DOM-only private brands through type-only
predicate target extraction; no Original editor/node/selection graph is imported.
Their runtime tag/style bodies remain pinned. All 25 function contracts, including
brand identities, compile bidirectionally against Original in contract.type-test.ts.

Pure tests compare independent Original and actual functions on real DOM nodes,
including whitespace normalization, tag/style precedence, DOM traversal, opaque
setter errors, cleanup failure/retry, alignment flags and keyboard modifiers.
These are source contracts, not mounted editor or native-oracle acceptance.
