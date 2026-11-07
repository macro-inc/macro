# regress 0.12.0, patched

Source: the crates.io `regress-0.12.0.crate` release (MIT OR Apache-2.0),
upstream commit `aae35dee1596cc9a9caaad2425b088081c09e5d5`.
Archive SHA-256: `32eef8b209c3c1c15dbad02c1f30f9539f00dc7253e0cbcdaae442a50a09d7c1`.
The root `[patch.crates-io]` selects this copy. Registry bookkeeping, upstream CI configuration and the
packaged lockfile are omitted; the manifest omits the author's email to satisfy
the repository privacy check. Upstream tests and licenses are retained; email fixtures use the reserved
`example.com` domain for the repository privacy check.

Legacy ECMAScript `Canonicalize` uses one-unit uppercase mappings, excluding
non-ASCII-to-ASCII conversions. The upstream legacy literal path already used
uppercase, but its table lacked that guard and character classes still used
Unicode simple folding. This fork replaces the legacy table, inverse expansion,
and class closure; Unicode `u`/`v` folding is unchanged.

`src/legacy_case.rs` is generated from Node 24.0.0 / V8 13.6 / ICU 77.1, Unicode
16.0, by `crates/client/lexical/lexical_workspace_tests/record-icase.mjs`. It never
uses Rust's changing Unicode tables. Re-record with that Node binary:

```sh
node crates/client/lexical/lexical_workspace_tests/record-icase.mjs
cargo test --release -p lexical_workspace_tests regex_icase_v8
```

The consumer fixture records every BMP literal/class/negative-class equivalence
set, including surrogates, plus Markdown patterns and case-folding probes.
Singleton identity classes are implicit; negated sets are their complement.

`Regex::is_unicode` exposes the compiled Unicode flag so UTF-16 consumers can
select the code-point or code-unit input decoder without reparsing patterns.

Upstream repository: https://github.com/ridiculousfish/regress.
Upstream PR: not submitted (this work does not authorize external publication).
Remove the patch after an upstream release passes the consumer fixture unchanged.
