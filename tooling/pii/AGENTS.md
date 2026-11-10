# PII and secret scanning

## What it is

The pre-commit and scoped-check scanner for added text, merge imports and PR text.
`scan.py` applies repository exceptions; the optional Gitleaks pass retains its
own secret rules and verifies only the existing public-key fixture JWT exception.

## Boundaries

- Decode every gzip member, reject damaged input and apply rules to its logical filename and complete text; never treat compressed bytes as evidence that a body was scanned.
- Read staged compressed content from the index, keeping unstaged worktree content out of the commit decision.
- Scan decoded bodies with Gitleaks too; Git binary diffs do not expose their text.
- Keep full Gitleaks match reports in private temporary directories, suppress tool output and report only redacted findings before deleting the reports.
- Accept a generic-key finding in a sync transcript only when its exact flagged secret span lies inside a JWT verified against the public local test key; reject unrelated, crossing, damaged and wrong-key spans.
- Preserve same-path unchanged merge imports and the existing human-owned exception policy.

## Checks

- From this directory, run `python3 -m unittest test_scan.py`.
- Include Gitleaks on PATH for the actual decoded-body secret regression.
- Use `python3 tooling/pii/scan.py --files <paths...>` from the repository root to rescan complete existing bodies without staging them; `--skip-gitleaks` reports only the Python rules.
