# Local tools for the channels end-to-end suite

Kept from the machine the suite was built on; not part of the suite and not
meant to merge.

- `*.sh`, `*.cjs`: scripts that start a local stack, run the suite against it,
  repeat tests, apply a break and record a run. They assume paths under
  `~/.cache/channels-e2e`.
- `breaks/`: one file per deliberate break of the app, with the tests expected
  to fail for it, and `results.tsv` with what happened.
- `proof-page/`: the page that reports the suite and the breaks.
- `run-reports.tar.gz`: the Playwright JSON report of each local run.
- `spec-brief.md`: the brief the spec files were written from.
