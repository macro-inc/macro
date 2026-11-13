# Agent guidance per SDK area

How an agent learns the rules of an area of Macro (databases, CRM, email,
calendar, channels, tasks, routines, documents, coding agents, search): one
source in the SDK's TSDoc, delivered inline or per turn.

## Source

Each SDK entity's namespace class (and the `search.ts` module comment for
cross-namespace search) carries two agent-only TSDoc block tags:

- `@routing`: one "Use when …; not …" sentence, exactly one per entity. It is
  the entity's description everywhere agents see it, and the question Jev
  answers for it.
- `@agent`: how the area works, when agents need rules beyond the API.

`packages/sdk-docs/src/render.ts` collects both and strips them from the
public reference. `packages/code-mode-sdk/scripts/generate.ts` puts them into
the code-mode catalog (`documentation.json`, built by `crates/code_mode_assets`)
as each entity's `description` and `guide`, and appends a namespace's guide to
its `ReadCodeDocs` reference. Generation fails on a missing routing sentence.

## Delivery

```
                         ┌─ owner without `auto-skills` ──────────────────────────┐
code-mode agent turn ────┤  prompt = cross-cutting rules + inline_guides()        │
                         │  turn   = select_documentation(Inline): ≤4 indexes      │
                         └─ owner with `auto-skills` ─────────────────────────────┤
                            prompt = cross-cutting rules (routed_prompt)          │
                            turn   = select_documentation(Selected):              │
                                     Jev over every entity's @routing sentence,   │
                                     parallel calls of 32, 1 s, ≥0.5, top 4 →     │
                                     index + @agent guide per entity              │
direct-tool hosts (chat): prompt + inline guides that do not need the SDK
channel bot (code mode): reply-only code-mode rules + every inline guide
database-only host: base prompt + the databases guide
public MCP: shared rules + databases, CRM and document-content guides;
            DescribeCodeTools returns entities with their guide
```

The selection runs in the turn's pre-turn join, alongside the memory fetch.
Its span records the Jev calls (`batches`), selected entities, bytes and
status. A call that fails or misses the deadline loses only its own entities;
the turn keeps what the other calls ranked.

## Where to change things

- An area's rules: its namespace's `@agent` block in `packages/sdk/src/entities/`.
- What an entity is for: its `@routing` sentence.
- Which entities direct hosts and MCP carry inline: `GuideHost` and
  `mcp_guides` in `crates/agent_code_mode/src/domain/documentation.rs`.
- Measure routing with `entity_route_evaluation` (ignored test in
  `agent_code_mode`; needs `TYPESAFE_API_KEY`).
