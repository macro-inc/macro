# universal_input

Read-only intent classification and editable field extraction for Command K.

- `src/domain.rs` owns admission, draft bounds, verbatim note preservation,
  and event timestamp validation/defaults. `domain/temporal` resolves typed, source-backed
  temporal expressions against the request clock and timezone. Providers interpret natural language;
  domain validation must not re-parse it with regexes. `domain/fallback.rs` owns provider failover policy.
  `domain/search.rs` selects search type before extracting its supported facets.
  Extraction schemas and field names derive from the typed search response models;
  every model field requires guidance, enforced by tests. Providers share
  `prompts/extract_search_query_prompt.txt` so filter-only searches have no query.
- `prompts/` holds classification questions and all extraction instructions, including typed field guidance
  and temporal task/output instructions; see `prompts/README.md` for the file map.
- `src/outbound.rs` implements the field-extraction port through the shared
  model router; `outbound/clairic.rs` implements Cloudflare typed content extraction,
  rejects search field claims that reuse source occurrences, and
  `outbound/temporal.rs` extracts temporal facts with Nemotron.
- `src/inbound/axum_router.rs` owns authenticated HTTP routes. The harness root
  composes providers and mounts the router under `/universal_input`.
- Suggestions contain display text, never authorized entity identifiers.
  Submission and permission checks belong to the destination services.
- `eval/baseline.json` and `eval/compare.py` compare live classification and
  extraction against fixed expectations; see `eval/README.md` for the frozen
  clock, fixture identity resolution, reports and before/after comparisons.
- Keep classification prompts within the shared Jev question limit; the intent
  prompt contract test validates them. Treat an opening destination action as a
  strong classification signal, above its body topic, across every intent.
- Give each new first-class suggestion field an extraction owner: add it to
  `InputIntent::extraction_fields` and typed guidance, or to the domain/temporal
  path. The response-field ownership test catches omitted fields. Task creation
  properties use the dynamic catalog and need no per-property schema edit.
- When adding a search facet, update the shared web search schema, its typed Rust
  search response and field guidance, then regenerate clients. The frontend
  `queries/extracted-search.ts` mapping covers each type-specific shared facet key;
  keep it exhaustive and add a baseline example. Tags/tagMode remain keyword text.
  Task-creation properties and task-search options use supplied catalogs. Search
  type selection receives no task catalog; only Task field extraction receives
  task options, so unrelated metadata cannot influence another type.
- Keep all public API documented; the crate denies missing documentation.

## Observability

`src/telemetry.rs` defines bounded failure categories. Provider spans record model,
token usage, fallback path/reason and build-generated prompt/recipe fingerprints.
Never add draft text, extracted values, provider bodies or caller-supplied labels
to traces. Admission and failover remain domain policy; telemetry does not change
provider selection. The recipe fingerprint covers production Rust source as well
as prompt templates; it is a build identifier, not runtime configuration.
See `eval/README.md` for read-only local quality and latency evaluation.

## Checks

- `cargo test -p universal_input` from the repository root with `SQLX_OFFLINE`
  unset.
- `just check`.
- With model credentials configured, run the opt-in prompt regression with
  `cargo test -p universal_input search_query_excludes_consumed_filters -- --ignored`.
- `python3 -m unittest discover -s crates/universal_input/eval -p 'test_*.py'`
  checks the baseline comparison logic without calling providers.
