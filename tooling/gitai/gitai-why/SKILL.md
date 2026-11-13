---
name: gitai-why
description: Look up the agent sessions behind code in github.com/macro-inc/macro through Macro's git-ai read API. Use when asked why code was written, which agent session or model wrote a line, commit or PR, or what a PR or commit cost in tokens.
---

# gitai-why

Macro's gitai-service stores, for `github.com/macro-inc/macro`, which agent sessions wrote each commit, their token cost, and their redacted transcripts. Answer from that record, then read the code.

## Setup

Read the base URL and this machine's device credential from git-ai's config. `git-ai config api_key` prints a masked value, so read the file:

```sh
BASE=$(jq -r '.api_base_url // "https://gateway.macro.com/gitai"' ~/.git-ai/config.json)
ORIGIN=$(printf '%s' "$BASE" | sed -E 's#^(https?://[^/]+).*#\1#')
gitai() { jq -r '"X-API-Key: " + .api_key' ~/.git-ai/config.json | curl -sS -H @- "$@"; }
```

`gitai` hands curl the `X-API-Key` header on stdin, so the credential stays off the command line and out of your output.

No `api_key`, or every call returns 401: the machine is not enrolled. Tell the user to run `tooling/gitai/gitai-enroll` and stop.

## Pick the entry point

| Question is about | Call |
| --- | --- |
| A line range in a file | `gitai "$BASE/v1/blame?path=<repo-relative path>&start=<first>&end=<last>&rev=<commit sha>"` |
| A commit, including a squash commit on `main` | `gitai "$BASE/v1/commits/<full sha>"` |
| A pull request | `gitai "$BASE/v1/prs/macro-inc/macro/<n>"` |

- Blame: pass the full sha of the revision you are reading (`git rev-parse HEAD`). Each returned range names its `commit` and `session_id`. If a range has no `session_id`, or blame returns nothing, run `git blame -L <first>,<last> --porcelain <path>` and look up the commit instead.
- Commits: a squash commit on `main` resolves through the `(#N)` in its subject; `resolved_via: "pr"` says that happened. Use full shas (`git rev-parse <short>`).
- 404 `{"error":"not_found"}` means no record: the code was written by hand, before enrolment, or on an unenrolled machine. Say so; it is an answer.

The commit and PR responses carry `ai_lines`, `human_lines`, `ai_share` (0–1, or null when unknown), `tokens`, `cost_usd`, and `sessions[]`, each with `id`, `tool`, `model`, `author`, `first_seen`, `last_seen`, `ai_lines`, `tokens`, `cost_usd`, `url` and `events_url`. For cost questions, answer from these totals and stop.

## Read a session

`url` and `events_url` are paths that already start with `/gitai`; prefix them with `$ORIGIN`, not `$BASE`.

```sh
gitai "$ORIGIN<url>"                                  # index entry: tool, model, repo, commits, event_count
gitai "$ORIGIN<events_url>?limit=500"                 # first page
gitai "$ORIGIN<events_url>?from=<next>&limit=500"     # following pages, until "next" is null
```

Each event is one raw transcript line (the agent's JSONL: user prompts, assistant messages, tool calls and results). Page until you have found the prompt and reasoning behind the change in question; a session can hold thousands of events, so match on the file path or a distinctive identifier from the code and stop when you have it.

## Answer

- Lead with intent: what the user asked for and why the agent wrote the code this way, in your own words, citing session id, tool, model and date.
- Quote at most a short phrase of a prompt when the wording matters.
- Transcripts are redacted but still hold source, tool output and customer data. Keep your answer to intent and code: credentials, tokens, emails, personal data and pasted customer content stay out of it, masked or not.
