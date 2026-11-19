# Local run records for the channels end-to-end suite (approach B)

Kept from the machine the suite was run on; not part of the test suite and not for merging.

- `cache/`: the scripts that built the bundles and ran the suite (`run.sh`, `build-bundle.sh`, `stage.sh`, `tally.sh`, `final*.sh`, break scripts), per-run tallies (`*.tsv`), run logs (`logs/`), break records (`breaks/`) and evidence screenshots (`evidence/`). Paths inside the scripts point at the original machine and need changing. The stack's env file, built bundles and Playwright traces are left out.
- `scratchpad/`: the result page (`channels-device-proof.html`), the pull request body (`pr-body.md`), probe specs and working files.
