---
name: review
description: Pick and run the risk reviews that apply to a diff before it is pushed or opened as a pull request. Use before every push to a PR, when asked to review a change, and whenever a diff touches SQL, query builders, or migrations.
---

# Review

A review asks what a change does in production: at real table sizes, during a
rolling deploy, when a page fires it again and again. The `audit` skill runs
the mechanical checks (tests, lint, rules); it does not replace a review, and a
review does not replace it.

Every PR pass runs at least one review from this table. Run every row that
matches the diff, not just the first.

## 1. Pick the reviews

```sh
base=$(git merge-base HEAD origin/main)   # the PR's base branch; not main for a stacked PR
git diff --name-only "$base" HEAD
git diff "$base" HEAD -- '*.rs' '*.sql' | grep -nE '^[+-].*(sqlx::query|query_as|query_scalar|query_file|QueryBuilder|push_bind|\.push\()' | head
```

Review commits, which are what a push sends; commit or set aside uncommitted
changes first. Pass the same base to every review you run.

| The diff changes | Run |
| --- | --- |
| SQL that runs in a service: `sqlx::query*!` call sites, `.sqlx/` entries, `QueryBuilder` or other assembled SQL, Soup or GraphQL filters that become SQL, or a SQL function, view, or trigger that queries call | [`query-review`](../query-review/SKILL.md) |
| A caller of an existing query: a new loop around it, a new page or job that fires it, or a wider scope passed to it (one user → a team, one item → a list) | [`query-review`](../query-review/SKILL.md) |
| A file under a `migrations/` directory | [`migration-review`](../migration-review/SKILL.md), and `query-review` for any function, view, or trigger it defines |
| Nothing above | A general review of the diff by a reviewer that did not write it: [`qc`](../qc/SKILL.md), or the review your session already runs before a push |

When a database row matches, the general review is optional.

These reviews check finished work. The author of a query follows the
[`query-writing`](../query-writing/SKILL.md) skill while writing it, and
`query-review` checks the plan that skill records.

## 2. Run them

Delegate the database reviews to the `db-reviewer` subagent when it is
available, passing the base. It keeps plans and query text out of your context
and returns one findings table. Otherwise follow the two skills yourself.

The author's reasoning is not a review. Start the reviewer from the diff, not
from your explanation of why the query is fine.

## 3. Act on the findings

| Severity | Meaning | Before pushing |
| --- | --- | --- |
| `block` | Can overload or lock the database, or break deployed code | Fix it, then rerun the review on the fix |
| `fix` | Wasteful or fragile at real size, but bounded | Fix it, or justify it in the PR body |
| `note` | Assumption worth stating | Nothing required |

A finding is closed by a code change or by evidence, never by rewording.
"It is fast locally" on an empty table is not evidence.

Put the database reviews' result in the PR body under `## Database review`
(see the `git` skill) whenever one ran, including for a caller-only change:
each query or migration statement, the rows it touches, the index or lock it
relies on, and how that was checked.

## Not in this path yet

Architecture (hexagonal skill), observability, and permission checks are still
verified as rule bullets by `audit`. Each becomes a row here when it gets a
review procedure with evidence of its own, the way the database reviews have.
