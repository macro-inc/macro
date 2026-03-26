# fast-search extension

Custom pi tools for fast retrieval + focused analysis.

This extension also overrides the built-in `grep` and `read` tools so pi prefers the fast search + targeted read workflow by default in this project.

- `grep` — overridden to use one fast ripgrep process by default
- `read` — overridden to use cached narrow line-range reads by default
- `search_and_read_best` — one-shot search + deterministic ranking + cached span reads
- `rg_parallel` — parallel ripgrep subprocess search
- `read_spans` — cached concurrent targeted span reads
- `spark_analyze_hits` — delegate hit ranking / span planning to `gpt-5.4-spark`

## Usage

Put this directory under `.pi/extensions/fast-search/` and run:

```bash
pi
# or reload if already running
/reload
```

Recommended flow:

1. `search_and_read_best` for fast exact lookups
2. `grep` for broader lexical search
3. `spark_analyze_hits` when lexical results are ambiguous
4. `read_spans` for wider follow-up reads

## Notes

- `spark_analyze_hits` expects a model entry like `openai/gpt-5.4-spark` to be available in pi.
- `rg` must be installed locally and on `PATH`.
