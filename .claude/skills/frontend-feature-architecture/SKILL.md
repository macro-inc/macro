---
name: frontend-feature-architecture
description: Structure, refactor, and review frontend feature folders in apps/web using layered responsibilities, separate production composition, and narrow feature-owned contracts. Use when adding a feature, moving feature modules, separating data and UI, or changing feature dependency injection and composition boundaries.
---

# Frontend feature architecture

Apply the layered frontend architecture developed from `features/activity` in
PR #6176 (`f598574d7`), with the stronger composition and capability boundaries
below. Activity demonstrates the layer responsibilities but still combines its
context with production wiring and injects a raw GraphQL client into state logic;
those are migration gaps, not patterns to copy. For a focused edit, keep the
changed code within its owning boundary without expanding into an unrelated
migration.

Read `apps/web/AGENTS.md` and
[docs/FRONTEND_FEATURE_ARCHITECTURE.md](../../../docs/FRONTEND_FEATURE_ARCHITECTURE.md)
before designing or reviewing a restructure. The document is the detailed source
for responsibilities, examples, migration steps, testing, and reference exceptions.
FE-33 in `docs/STYLE_GUIDE.md` is the summary rule.

Paths in this skill are repository-relative unless linked otherwise. Locate the
repository root before running commands. This skill is shared through
`.claude/skills/frontend-feature-architecture` and
`.agents/skills/frontend-feature-architecture`; maintain one copy of its contents.

## Classify before editing

Inspect the feature's imports, callers, tests, route registration, and flag gates.
Identify what is pure logic, transport adaptation, reactive behavior, presentation,
composition, an ambient capability, or a host-specific action. Do not infer the
architecture from existing filenames alone.

| Location | Owns | Keep out |
| --- | --- | --- |
| `core/` | Feature types, domain unions, pure grouping/descriptions/calculations | Solid, JSX, generated GraphQL, app capabilities, sibling layers |
| `queries/` | Wire decoding, selectors, feature-owned query/mutation factories and cache mechanics | JSX, components/views, hidden singleton clients |
| `primitives/` | Reactive use-case state and actions over feature-owned contracts | JSX, rendering imports, concrete query adapters, direct ambient app hooks |
| `components/` | JSX from domain values, resolved display, children/slots, handlers | Queries, feature primitives/context consumption, app navigation policy |
| `views/` | Context consumption and use-case composition | Duplicated query-state logic, direct ambient capability imports |
| `context/` | Feature-owned capability contracts and provider/consumer mechanism | Production imports or fallback, per-surface actions, prepared screen state |
| Production entry point | Construct adapters and supply them to a feature view | Feature state decisions, domain logic |
| `tests/` | Shared context/client mocks and wire helpers | Production dependencies on test helpers |

Create only the layers the feature needs. Use descriptive kebab-case modules and
the reference's plural layer names. Co-locate tests as `*.test.ts(x)`; no mandatory
root barrel or empty scaffolding. Host action adapters and rollout hooks can live
at the feature root.

## Preserve dependency direction

Read these arrows as “depends on”:

```text
production entry point -> query/app adapters + context provider + views
views -> primitives -> feature contracts -> core
views -> components -> core
views -> context
query/app adapters -> feature contracts
components -> context display types only
production wiring / host adapters -> app capabilities
```

Contracts can live in `context/` or a small dedicated module; they must not import
their implementations. Concrete clients are adapter inputs supplied by production
wiring. Feature state depends on the capabilities those adapters implement.

Consumers can use core directly. Inspect re-exports and aliases for cycles or
hidden dependencies. Keep actual network transport in service-clients and shared
server-state operations in `src/lib/queries`; feature-specific orchestration
belongs to the owning feature's `queries/`. Reuse the existing query library and
cache conventions rather than requiring a library migration.

Decode transport shapes into feature-owned types before they reach domain logic
or reusable rendering. Preserve explicit unknown/unsupported cases and missing
versus empty results. Other input surfaces, such as AI tools, adapt their own
transport to the same feature model.

## Separate production composition

Keep dependency contracts and the Solid provider/consumer separate from production
adapter construction. Importing a feature context or state module must not initialize
app services, sockets, workers, or global listeners. A lazy function fallback does
not remove static imports of production dependencies.

Use an app-facing entry point to construct real adapters and mount the feature
provider around its view. Tests import the reusable view and supply their own
dependencies. The context consumer reports a missing provider clearly; it must not
silently fall back to production services. Direct dependency arguments are also
appropriate when a subtree context would add no value.

Production callers can still mount one convenient `<Activity />` wrapper. One
context module and one production entry point can provide this boundary; no DI
framework, class hierarchy, or extra directory per adapter is required. Keep
hook-based construction under its Solid owner and gate mounting before starting
feature resources. Inspect shared UI dependencies separately: moving context
wiring alone does not remove their transitive app imports.

## Introduce narrow feature-owned contracts

Use a feature-owned contract where meaningful feature behavior needs to be tested
or changed independently of its infrastructure. Describe domain values and the
operations the consumer requires. For example, feed state needs an activity event
source with request status and pagination actions; it should not receive an urql
`Client` and construct concrete GraphQL queries itself.

Query adapters implement that source using existing query/cache infrastructure.
Keep documents, variables, decoding, cursors, cache mechanics, and transport-error
translation in adapters. Keep grouping, visible-state selection, and the decision
to retain rows during background failures in primitives. A source reports data
availability; it must not return a precomputed screen view-state that moves those
decisions into infrastructure.

Solid accessors and factories are appropriate in these contracts. Accept Solid
as the reactive foundation instead of wrapping it in a custom framework. Preserve
enabled inputs, updates, pagination, owner cleanup, and the chosen resource-read
semantics; a promise-only replacement can lose required behavior. Factories must
run under the consuming Solid owner, not create a global feature-state singleton.

Pass a source directly to a primitive or use a narrow `Pick` of dependencies.
Do not expose generated GraphQL shapes, concrete clients, or library-specific
query result types in the consumer contract. Avoid generic `Repository<T>` APIs
or interfaces for every helper. If a wrapper merely forwards values and protects
no independent behavior, do not create a new layer just to justify a contract.
See the document's “Feature-owned contracts” section for the feed example.

## Choose context or props deliberately

Put an ambient capability used the same way on every surface in one feature
context record. Activity's viewer ID, display-name resolver, entity display
resolver, and property-definition resolver illustrate useful capabilities. For
data access, supply factories implementing feature contracts rather than placing
the raw GraphQL client in the consumer's dependency record.

Keep changing inputs reactive with accessors. Keep props for instance data and
resolved leaf values.
Do not add environment-derived values or one consumer's prepared state to context
without an actual dependency-replacement need.

Host-specific behavior is a callback prop. A primitive can translate an event to
a target; the host adapter performs navigation or another host action. Omitting
an optional action omits its handlers. If the whole surface must be inert, inspect
nested widgets too. Keep rollout flags out of context and gate mounting before
query-owning components initialize.

## Separate state, presentation, and composition

Have screen primitives return explicit view-state unions and named actions, so
loading, errors, emptiness, pagination, and background data precedence are decided
once. Small helpers may return a simple accessor; do not manufacture a state
machine for every function.

Have components render supplied values and callbacks. Solid control flow, local
presentation derivations, shared UI, and scoped presentation contexts are fine.
Move feature capability resolution and reusable reactive orchestration into
primitives/views. Views can keep small local layout helpers and UI state with
their only consumer.

Use these reference pairs when a boundary is unclear:

- Domain and wire: `activity/core/event.ts` and `activity/queries/decode.ts`.
- State and rendering: `activity/primitives/my-activity.ts` and
  `activity/views/my-activity-view.tsx`.
- Presentation and wiring: `activity/components/activity-timeline-row.tsx` and
  `activity/views/activity-timeline-row.tsx`.
- Existing capability signatures and test helpers: `activity/context/activity-context.tsx`
  and `activity/tests/mock-context.ts`. Their production fallback and raw-client
  injection still need the migration described above.

These paths are under `apps/web/src/features/`. Follow existing Solid rules on
resource reads, effects, and memo use; the folder layout does not override them.

## Migrate and verify

For a restructure, extract core and wire adapters, separate production composition,
then introduce narrow source contracts where reactive decisions currently depend
on concrete adapters. Split reactive state from presentation and update all hosts
and imports. Composition isolation is useful even before a source-contract
migration. Preserve query enabling, cache/pagination behavior, entity switching, route fallbacks, and
required presentation providers unless the task explicitly changes them.

Register the adopting feature's layer globs in both the `ts-` and `tsx-` versions
of all four `rules/ast-grep/*feature-*` families: `core-pure`,
`components-presentational`, `data-no-ui`, and `layers-use-context`. The detailed
document maps each family to its layers. They currently warn and cover activity;
a clean scan does not prove the whole dependency graph is valid.
These rules do not yet enforce separate composition or source-contract dependency
inversion; review those boundaries explicitly and report remaining gaps.

Test the behavior that changed at its owning layer: pure core/decoder tests,
query-adapter tests with a fake client, `createRoot` with fake feature sources for
reactive decisions, and provider-backed view tests for visible state and callbacks.
Keep integration tests that exercise adapters and primitives together. Dispose
test roots. Primitive unit tests should control domain data/status without naming
GraphQL operations; adapter tests verify wire behavior. Exercise the real code of
the layer being tested and replace its dependencies through the contract.
Check that importing context/state does not require production-service quarantine,
and that omitted provider setup fails clearly instead of reaching the app.
For implementation changes, run relevant `bun run test <feature-path>` and
`bun run check` from `apps/web`, and exercise user-visible changes in a browser
per its AGENTS.md. Run the feature-scoped ast-grep scan from the repository root.
Update `docs/AGENT_GUIDE/` when interactions or routes change.

Before treating a reference pattern as a universal rule, read the document's
“Enforcement and reference limitations” section. Activity has narrow exceptions
for a pure soup date utility and property-value parsing; view tests retain shared
UI stubs and websocket import quarantine. Do not generalize those into permission
for dependency leaks or describe the reference as entirely free of `vi.mock`.

Report the boundaries changed, relevant verification, and any remaining concrete
exceptions or limitations. For a review, distinguish a violated architecture rule
from an activity-specific implementation choice.
