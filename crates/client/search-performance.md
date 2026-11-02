# Streaming search optimization measurements

The scan and borrowed-row comparisons use 100,000 synthetic short contact-like titles, a result
limit of 50, release builds, and one local machine. They are not production
latency guarantees. Those comparisons preserved their original matching/ranking;
the subsequent deterministic person policy is measured separately below.

## SQL scan comparison

Run from the repository root:

```sh
cargo test --release -p cache-turso --lib compare_search_scan_options -- --ignored --nocapture
```

The test uses a disposable filesystem database. It alternates six modes, discards
two warmup rounds, and reports the median of seven warm samples. It includes SQL
filtering and row decoding, not engine ranking. The owned-row modes reproduce the
previous copying path; borrowed-row modes use the production visitor. The fixture
adds a legacy non-covering index alongside the production covering index, whose
plan is checked with `EXPLAIN QUERY PLAN`. The measurements below were captured
during the prototype, before enabling the same covering layout in schema 12.

| Native scan, milliseconds | Broad match | Selective match | No match |
| --- | ---: | ---: | ---: |
| Owned rows, prepare each query | 114.1 | 87.1 | 92.5 |
| Owned rows, reuse statement | 115.7 | 86.9 | 92.4 |
| Owned rows, covering index | 63.5 | 38.4 | 43.4 |
| Owned rows, covering index + reuse | 66.0 | 38.2 | 43.3 |
| Borrowed rows, prepare each query | 92.1 | 86.9 | 92.4 |
| Borrowed rows, covering index | 43.2 | 38.2 | 43.4 |

Average preparation was 70–74 microseconds. A production statement cache was not
added: eliminating preparation is immaterial compared with scanning here.
Borrowing helps most when many rows pass the SQL filter. Covering avoids table
lookups even for rows rejected by that filter, but still performs a bucket scan.

## End-to-end borrowed-row comparison

A separate temporary allocator-instrumented harness ran the same six-query
sequence before and after borrowing. It reopened the seeded database before the
first search, so the first search also warms database caches. These are individual
samples, not the seven-sample medians above.

| Engine search, milliseconds | Owned streaming | Borrowed streaming | Borrowed + covering prototype |
| --- | ---: | ---: | ---: |
| Native first broad search | 158.0 | 103.3 | 55.9 |
| Native warm broad search | 153.4 | 99.6 | 49.7 |
| Native warm selective search | 87.4 | 86.5 | 38.6 |
| Browser OPFS first broad search | 211.6 | 161.2 | 101.6 |
| Browser OPFS warm broad search | 164.5 | 122.1 | 63.8 |
| Browser OPFS warm selective search | 102.1 | 103.2 | 49.1 |

The end-to-end covering prototype appended text/hash columns to the existing
browse index on fresh disposable databases, then reverted that schema experiment.
That measurement did not migrate an existing cache. The same layout now ships
with the intentionally incompatible schema-12 cutover described below.

Borrowing reduces allocation churn rather than the retained footprint, which was
already bounded by streaming. Approximate retained allocations added by the first
search stayed at 5.2 MiB natively and 21.6 MiB in the browser, including database
caches. Warm broad searches used about 37 KiB / 27 KiB of additional peak live
allocations respectively and retained essentially nothing. These allocator
measurements are not process RSS or the WASM linear-memory high-water mark.
The covering prototype retained approximately 5.2 MiB / 20.7 MiB respectively,
with warm broad-search peak additions of 31 KiB / 22 KiB. It did not reintroduce
corpus-sized search catalogs. These trials do not measure cold-cache rehydration
or disk-space growth across large real corpora.

## Normalized contact hydration

```sh
cargo test --release -p cache-turso --test contacts hydrate_and_search_100k_contacts -- --ignored --nocapture
```

A separate native filesystem trial hydrates 100,000 `GraphqlContact` records
through the actual `ContactDirectoryBackfill` operation, in 200 pages of 500,
with a 16-record hot LRU. Each page returns only its cursor projection; the test
asserts that the encoded viewer stays below 256 bytes without any contact page
fields. This is not a frontend JS-heap or process/WASM memory measurement.

One local release run took **3.20 seconds** to hydrate. After closing and reopening,
the query/browse/materialization scenario took **126 milliseconds** in total:
name matching, a late exact email with a null name, an absent query, and two browse
pages, projecting at most seven winning records per query. These are aggregate
single-run timings, not per-query medians. The normal native and real-OPFS suites
exercise the same contract at 1,500 contacts, including account reset. The browser
100k benchmark above still uses contact-like document titles, not normalized
contact hydration. The app still retains legacy contact arrays until its consumers
are migrated; these cache-engine results do not establish whole-app memory bounds.

Projection 5 adds contact membership and advertises `projectionVersion` on search
responses. It rebuilds only derived rows, without another storage-schema cutover.

## Context-aware person-policy prototype

`cargo test --release -p cache-turso --test people people_policy_100k -- --ignored --nocapture`
measures the new person-policy API against 100k normalized synthetic people, with
50 winners and an empty published context. A local release sample took roughly
345 ms for the first broad query, 340 ms warm, 43 ms selective, 39 ms absent, and
308 ms empty-query ranking. These are single samples, not medians or UI timings.
The existing joined-record path decodes one matching record at a time; it does
not retain the directory but is slower than the covering-only generic search.
Scope publication, secondary-inbox/explicit exclusions, late DM winners and
conversation deduplication are checked separately over native and OPFS storage.
Host transport is implemented; context publishing and Quick Access wiring are
not yet enabled.

## What ships

The adapter borrows row fields, validates every row, and reuses one key buffer.
Core ranking owns only its `limit + 1` winners. The covering browse index includes
text and source hashes, avoiding base-table lookups. Contact support separately
adds the projection revision to search replies.
Native and real-OPFS parity tests cover Unicode, SQL wildcard escaping, NUL,
ordering, and late winners; engine tests cover optimistic replacement and settlement.

Storage schema 12 deliberately drops compatibility with schema 11. No migration,
queue transfer, compatibility-reader release, or rollout gate is added. Native
upgrades reset the fixed cache file, discarding queued cache mutations and
optimistic layers along with refetchable records. Browser upgrades open a fresh
versioned file; cleanup still preserves older files with queued mutations, but
those queues are not replayed by the new engine. Rollback across the native
schema boundary also uses the existing incompatible-cache reset behavior.
That index cutover kept the schema epoch, record format, and search projection
version unchanged; the subsequent contact projection revision is described above.
