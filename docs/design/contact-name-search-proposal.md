# Name-focused contact search — approved, implementation in progress

The previous contact search was memory-bounded, but broad subsequence reads still
scored most of the directory. This proposal changes the interactive **people search
contract**, not ordinary document/title search, SQL capability, membership authority,
or exact-reference ambiguity evidence. The matching/recent-first contract is approved.

## Implementation checkpoint

- [x] Shared name-only exact/word-prefix/literal-contains matcher, with existing
  Unicode lowercase/whitespace normalization (no newly introduced accent folding).
- [x] Explicit identity/complete-address classification and stable timestamp/user-ID
  BLOB ordering, independent of rebuilt index-document IDs.
- [x] Bounded word facts with an explicit overflow marker, default ranks and sparse
  epoch-scoped activity/DM/inbox facts in the existing owned predicate projection.
- [x] Fact-delta persistence and bounded derived-version rebuild preserving records,
  pending writes and storage generation; context changes do not rewrite name words.
- [x] Indexed hybrid reader, before-limit exclusions and query-dependent DM alias
  handling, and scope/projection/context-safe continuations. Native and OPFS paths
  match a complete streaming reference.
- [x] Local-only browser/native policy-5 cutover. Consumers preserve the returned
  personal order; interactive server fallback and the old person scorer are removed.
  Exact-reference APIs retain their independent policy-4 contract.
- [x] Browser/native/OPFS correctness and fresh persistent-profile 1k/100k comparison
  for `94dce7c0`. Common 100k queries/paging are near the 1k controls, with measured
  index/write costs.
  Remaining surfaces, in-place lifecycle performance and physical devices are not
  covered by this synthetic acceptance.

`Engine::search_people` now uses `NameSearchRead` and the indexed storage path.
Suggestions never call server search or downgrade to generic text search. Partial
hydration returns partial local windows; missing/older capabilities and unpublished
context remain explicitly unavailable. Refresh schedules the existing background
sync lane. Live contact changes invalidate pending replies and restart paging.
Scoped extras and selected labels remain separate; ordinary entity scoring is unchanged.

The reader uses at most 129 probe IDs and K+1 winners. Broad probes inspect at most
4096 rank keys per default/current-epoch stream; when that is insufficient, complete
matching streams preserve correctness. Small posting sets reuse their bounded IDs.
Contains predicates filter the covering name value before record lookup. Epoch-tagged
overrides cannot contaminate the default order after context replacement; cursor
ties use canonical user IDs, never index row IDs. Continuations also bind the live
contact admission token and a separate context token: same-epoch patches invalidate
pages, while no-op publication and unrelated cache writes do not. Name-word overflow and incomplete
projections have explicit streaming paths. At most K+1 DM targets need prior-alias
lookups; no earlier-page identity catalog is retained.

A 100k native **in-memory Turso** test of this actual reader measured roughly 2–3 ms
for broad/exact/empty reads, 20 ms for a late sparse prefix and 27 ms for no match,
with each answer checked against a complete streaming reference. These are engine
measurements, not browser/OPFS latency or whole-app acceptance.

## Recommendation

Use **name-prefix-first search with an indexable recent-first order**, not simply
replace the wildcard pattern or add a standalone text index.

- Prefer exact normalized full-name matches, then contacts whose name words start
  with every query word. `jo sm` finds a name with John and Smith; query-word order
  need not match display order.
- Within a matching tier, order primarily by the existing published interaction
  recency, with a deterministic identity tie-break. This deliberately replaces the
  current weighted fuzzy/brevity blend; it is not the same ranking contract.
- Keep full email addresses on the exact identity path, never name aliases. An
  explicitly typed address prefix can use an indexed email-prefix path.
- Offer contiguous substring matches as a lower-priority fallback when prefixes
  are exhausted. This matters for middle-of-word queries and names without spaces.
  Do not silently restore arbitrary-gap subsequence scans on every query.
- Empty input should use a bounded indexed recent/browse path, rather than compute
  a score for every contact. An alphabetical browse path is another explicitly
  ordered choice, not a substitute for recency without a product decision.
- Preserve original labels. Define Unicode normalization and accent-folding before
  indexing; the prototype below uses the existing lowercase normalization, not
  accent folding or transliteration.
- Preserve self, exclusions, secondary-inbox filtering, account/session isolation,
  selected/custom values, and command DM dedup **before returning a limited page**.
  The fast prototype does not establish these production integration properties.

Behavioral tradeoffs are explicit: `jhn` no longer finds John through gaps;
`ohn` and a given name inside an unspaced full name require the contains fallback.
Exact reference inference/import must continue to require its independent complete
per-label evidence, not uniqueness inferred from these suggestions.

## Why matching alone is insufficient

The current pattern `%j%o%h%n%` and a substring pattern `%john%` both start with a
wildcard. An ordinary B-tree still scans. Substring matching often produces fewer
candidates, but genuinely common queries still require ranking many matches.

A naive word-prefix index has the same second problem: retrieving 30k matches
through several index lookups and then scoring them can be slower than a scan.
The substantial gain comes from combining **indexable matching and indexable
ordering**, so a common query can stop once it has the correct first 50 results.

## Disposable native Turso prototype

Artifacts: `/tmp/contacts-name-search/`. That pre-approval experiment changed no
application code, schema, user cache or backend. A fresh synthetic database uses the same pinned Turso revision
and existing generic index shapes (`index_documents`, `exact_facts`, `integer_facts`),
with normalized contact blobs and the current covering record index.

The corpus has 100k generated, skewed human-name-shaped labels, common-name
collisions, optional middle words, hyphens, apostrophes, accents and an unspaced
Japanese-name case. It is not a statistically representative user directory.
Word-prefix facts add 230,376 token rows (about 2.3 per contact). Production disk,
write, browser/WASM and device costs are not established by this prototype.

Warm native medians below exclude the first of six runs. The first column streams
current-style subsequence candidates through decoding and a bounded scorer using
the shared recipient scoring functions with no activity timestamps. The proposed
rank model uses deterministic simulated recency; equal/no-recency ties were tested
separately. Neither includes the entire production policy/transport path. This is
**not a full application benchmark or a drop-in speedup**. The proposed column uses
the different recent-first contract:

| Query | Subsequence + scoring | Bounded prefix/recent prototype |
| --- | ---: | ---: |
| `jo` | 127 ms | 1.1 ms |
| `john` | 85 ms | 2.3 ms |
| `jo sm` | 143 ms | 13.7 ms |
| `alex` | 161 ms | 10.7 ms |
| `ale sm` | 330 ms | 62.2 ms |
| Missing prefix | 35 ms | ~0.01 ms before any contains fallback |

These are query-kernel samples, not promised browser latency. The more selective
`ale sm` demonstrates why no single execution plan wins everywhere. Substring-only
reads took about 50 ms for `jo sm`, 56 ms for `alex`, and 45 ms for `ale sm` on this
corpus: simpler matching is useful, but does not provide the same early-stop path.

Unbounded recent-first scanning was also tested and rejected: rare/no-match queries
took roughly 750 ms. The bounded hybrid instead:

1. Probes each word-prefix posting range with a fixed 129-row bound.
2. Returns no prefix matches immediately when a word has no posting (a contains
   fallback is separate work, not included in that timing).
3. For broad candidates, obtains one rank-position bound covering at most 4,096
   rank entries, then reads matching rows in that indexed order until 50 are found.
   The rank boundary includes its tie-break; separate before-boundary and equal-
   boundary ranges avoid an unbounded scan of a large timestamp tie. It is not a
   time-only cutoff.
4. If that budget cannot fill the result, discards the provisional answer and
   streams prefix-driven candidates through a bounded top-50 selection instead.
   A budget-limited scan is never reported as complete absence.

A first materialized-CTE attempt cost about 33 ms even for common queries. A keyset
rank bound retained early stopping and reduced that overhead. Both unique simulated
recency and all-equal/no-recency cases were checked against an independent streaming
reference for exact winners; reverse query-word order and duplicate name words were
also exercised. The prototype retains only bounded winners/probes, not a directory
array. A naive longest-token seed was inferior to a more selective posting range.

## Implementation direction and unresolved boundaries

- Derive viewer-scoped name-word facts from authorized normalized contacts, using
  the existing Turso indexing/storage ownership. Seek prefix ranges as bound bytes;
  do not rely on locale-dependent `LIKE` range optimization.
- Keep recency and matching facts independently maintained so an activity update
  does not rewrite every word/prefix. Do not use relationship `updated_at` as DM
  activity. Include a default rank for contacts without activity, or provide an
  equivalent complete fallback.
- Hold a consistent storage snapshot across rank-bound probing and result selection.
  Scope/cursor invalidation must include matching policy and relevant projection/
  context generations. Production tie-breaking cannot accidentally depend on an
  unstable rebuilt index-row ID.
- Apply real membership, inbox, explicit exclusion and DM-alias rules before early
  stopping. The synthetic probe only checks its simplified owner/state/name/rank
  model; command surfaces need particular care.
- Bound per-name index derivation and input work. Long/malformed names and short or
  punctuation-only input need explicit behavior, not dropped membership or a
  directory-sized fallback buffer.
- Keep interactive suggestions local-only. Server access supplies authorized
  synchronization/removal evidence, not a fallback search request. Preserve deployed
  SDK/backend search compatibility independently.
- Benchmark the complete browser/OPFS path, realistic activity distributions and
  adversarial name/rank correlation before claiming the prototype gain. Measure
  index-write cost, disk, WASM capacity and retained JS again.
- Only after storage reads are fast should the existing 200 ms input debounce be
  reconsidered; lowering it alone would merely queue more expensive reads.

No FTS extension, external service, additional contacts database or in-memory
contact catalog is required by this direction. Name semantics and recent-first
ordering are approved; the integrated reader and its final storage behavior still
need validation.
