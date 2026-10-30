# Streaming search optimization measurements

These measurements use 100,000 synthetic short contact-like titles, a result
limit of 50, release builds, and one local machine. They are not production
latency guarantees. Fuzzy subsequence matching and ranking stay unchanged.

## SQL scan comparison

Run from the repository root:

```sh
cargo test --release -p cache-turso --lib compare_search_scan_options -- --ignored --nocapture
```

The test uses a disposable filesystem database. It alternates six modes, discards
two warmup rounds, and reports the median of seven warm samples. It includes SQL
filtering and row decoding, not engine ranking. The owned-row modes reproduce the
previous copying path; borrowed-row modes use the production visitor. The covering
index is test-only and is checked with `EXPLAIN QUERY PLAN`.

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
It did not migrate an existing cache or ship a production schema change.

Borrowing reduces allocation churn rather than the retained footprint, which was
already bounded by streaming. Approximate retained allocations added by the first
search stayed at 5.2 MiB natively and 21.6 MiB in the browser, including database
caches. Warm broad searches used about 37 KiB / 27 KiB of additional peak live
allocations respectively and retained essentially nothing. These allocator
measurements are not process RSS or the WASM linear-memory high-water mark.
The covering prototype retained approximately 5.2 MiB / 20.7 MiB respectively,
with warm broad-search peak additions of 31 KiB / 22 KiB. It did not reintroduce
corpus-sized search catalogs. Production startup rebuild cost, disk-space growth,
and old/new engine interoperability still need verification before rollout.

## What ships

The adapter borrows row fields, validates every row, and reuses one key buffer.
Core ranking owns only its `limit + 1` winners. Wire responses and the durable
schema are unchanged. Existing native and real-OPFS parity tests cover Unicode,
SQL wildcard escaping, NUL, ordering, and late winners; engine tests cover
optimistic replacement and settlement.

The covering index remains a benchmark prototype. The frozen schema validator
in older engines rejects a changed index layout; adding it without a compatible
rollout could cause a physical reset and lose pending writes. Any production
index change needs an explicit queue-preserving compatibility/rollout design,
with upgrade, rollback, and old/new engine ownership tested. No such migration
is included here.
