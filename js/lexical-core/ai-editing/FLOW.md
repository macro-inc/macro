# AI Editing — agent flow

> **Plan only.** MVP is deliberately one subagent. No parent, no review loop, no
> parallelism — those are later.

## The loop

```
              ┌─────────────────────────────────────────────┐
   document   │  1. host: load doc into an editing session   │
   snapshot ──▶  2. host: serializeWithIds(s)  →  markdown    │
              │     with block ids the model can lock onto    │
              └───────────────────────┬─────────────────────┘
                                      │  user query + id-annotated markdown
                                      ▼
              ┌─────────────────────────────────────────────┐
              │  3. ONE subagent (AI SDK tool loop):          │
              │     reads the markdown, reasons in plain text │
              │     ┌───────────────────────────────────┐    │
              │     │ calls an edit tool  ──▶ host runs   │    │
              │     │   it in editor.update()             │    │
              │     │ tool returns "ok: ..." | "error:..."│    │
              │     │   ◀── fed back to the model         │    │
              │     │ model self-corrects on error,       │    │
              │     │   repeats until done                │    │
              │     └───────────────────────────────────┘    │
              │     calls finish(summary)  ──▶ loop ends      │
              └───────────────────────┬─────────────────────┘
                                      ▼
              ┌─────────────────────────────────────────────┐
              │  4. host: toSnapshot(s)  →  write back        │
              └─────────────────────────────────────────────┘
```

## Why it's shaped this way

- **The doc is in the prompt, not behind a tool.** The model already sees every
  block and its id, so there are no query/search tools — it just looks at the
  markdown and emits edits. This also lets it apply judgment per-site (bold *this*
  "frog", skip the incidental one) instead of delegating to a dumb matcher.

- **Block ids are the anchor; inline edits add a substring.** Only top-level
  blocks are id-annotated. Inline edits lock by `(blockId, substring, scope)` —
  the substring is read from the markdown and passed as a tool argument, not
  discovered by a search.

- **Tools are write-only and return `ok`/`error`.** Each tool wraps the SDK call
  in `editor.update()`. A failed resolution (`EditError: node not found`) comes
  back as `"error: ..."`, which is the model's self-correction signal — there's
  no separate error channel because there's no separate agent.

- **One `editor.update()` per tool call = atomic.** A throw mid-call discards
  that call's partial changes, so a failed edit leaves the doc untouched and the
  model retries cleanly.

- **Ids are stable across edits.** Type swaps, merges, and rewrites keep the
  target's id; new nodes get fresh ids minted by `nodeIdPlugin`. So a later tool
  call in the same session can still reference a block the model saw at the start.

## Example turn

User: *"make the Notes heading an h2 and bold every 'Bluejay' in b5."*

```
prompt = query + serializeWithIds(s)

model → setBlockType(id="b14", type="heading", level=2)   → "ok: b14 -> heading"
model → formatText(blockId="b5", text="Bluejay", format="bold", all=true)
                                                          → "ok: 2 changed"
model → finish("Promoted Notes to h2; bolded 2 Bluejay mentions.")

host  → toSnapshot(s) → write back
```

If `b14` had been deleted earlier in the turn, `setBlockType` returns
`"error: node not found: b14"`, the model re-reads its context, and either picks
the right id or calls `reportError`.

## Explicitly out of scope (MVP)

Parent/review agent, diff-based acceptance, retries across turns, parallel
subagents, conflict detection, codegen/sandbox execution, lists/links/highlights,
tables/mentions/equations. Revisit only after the single-agent loop works.
