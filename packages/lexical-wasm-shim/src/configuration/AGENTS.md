# Pure editor configuration preparation

## Scope

Prepare actual registered-node metadata without constructing an editor or binding
a runtime. Omitted config with a supplied active registry reuses that exact map;
explicit config always builds fresh, including explicit parent configuration.
The caller owns the actual active-editor decision and subsequent assignment.

Keep the pinned default class order: Root, Text, LineBreak, Tab, Paragraph,
ArtificialNode. ArtificialNode is the generic Element subclass, not Paragraph.
Normalize each entry immediately before preparing its factories so user getters
and static preparation retain source order. Return source config snapshots and
the classes from actual registered rows, never hidden withKlass classes.

## Checks

Run package strict types/hooks, ordinary declarations, configuration/replacement
tests and scoped just check. Pure metadata tests do not prove active editor
inheritance, constructor authorization or native registration acceptance.

## HTML conversions

Use html-conversions.ts for pinned importDOM cache preparation: capture each
class getter once, deduplicate function identity, call with the first class as
receiver, preserve map key and registration order, and append configured imports.
The HTMLElement selector preserves priority and last-registration ties without
reading losing conversion getters. The full upstream Node/#text callback boundary
remains open; do not widen these callbacks through assertions or fake DOM guards.
This pure metadata module does not bind an editor/view or authorize constructors.
