# Soup list differential (#11219)

Runs main's web app and the branch's side by side on the same synthetic data
and compares what every moved reader returns, field by field and as its caller
shows it. Not part of any workspace or CI; run it by hand against a local stack.

```sh
just run_local --instance gqlsoup        # once
tooling/difftest/soup-list/run.sh        # everything; results/ and results/summary.json
```

`run.sh` checks that the two checkouts' `apps/` and `packages/` are exactly the
commits it names (`NEW_REF`, and its second parent as `OLD_REF`), serves each
from its own Vite with `probe/` copied in, and runs the passes in `PASSES`: quiet
(seed `A1`), under concurrent load (`B1`), with the browser cache off (`C1`),
mutants (`M1`: each planted mutant in its own lane, plus a control) and an A/A
control (`D1`: main against itself, the base rate of each difference kind).
The A/A serves main from a second checkout (`AA_CHECKOUT`, default
`<repo>-main2`, at `OLD_REF`) on the new side's port, so each side has its own
Vite as in the real passes; one Vite serving both sides made its steps several
times slower than theirs. Environment variables override the defaults at the
top of the script.

Each pass logs every sequence step with its duration (`seq <n> step <i> <kind>:
<ms> ms`), and each missed live update in the results carries the app's own
spans from that step, per side (`phases`). World building retries a document
create that failed on a backend hop (DSS answering 500 "error sending
request" to the lexical or sync service, on a loaded machine) and reports how
many it retried as `meta.setupRetries`; sequence steps are never retried.
A sequence step (its write, comparisons and any reload) has 15 minutes
(`DIFFTEST_STEP_DEADLINE_MS`): a dev-server page that never finishes loading a
module otherwise leaves an in-page await, and its lane, waiting forever. A step
past it is recorded in `sequences.hangs` with what each page showed, the pages
are loaded again, and the sequence runs again once with its earlier failures
dropped (`sequences.aborted`).

The driver and its browser run in a network namespace of their own
(`netns.sh`, with pasta forwarding the stack's and the two Vites' ports).
Chromium fails every request in flight with `net::ERR_NETWORK_CHANGED` when an
interface or address appears or goes, and on a machine where other containers
start and stop that is about every second; dev-server pages then came up blank
or failed a dynamic import. `repro/reload-blank.ts` shows it: 16 pages reloaded
at once outside the namespace all came up blank with that error; inside it, 96
of 96 rendered. At most four pages load at once (`DIFFTEST_PAGE_LOADS`), every
page's open requests are tracked so a stuck one says what it waits on, and a
lane whose pages fail to open is opened again in a new context, up to three
times (`meta.openRetries`).

`bun run against-aa.ts results/aa.json results/quiet.json ...` puts each
sequence failure bucket next to the A/A's rate for the same bucket, per 100
steps of that kind.

`repro/` holds the minimal repros of the differences the runs found; each says
what it shows and how to run it at the top:

| Repro | Shows |
| --- | --- |
| `or-chain-depth.ts` | Main's PR-link query nests one `or` per id and REST Soup rejects it past serde_json's recursion limit. |
| `team-property.ts` | A task's team select property as REST and GraphQL Soup return it, assigned and after its option is deleted. |
| `preview-option-delete.ts` | Whether a list read with `ignoresNotifications` sees an option deleted elsewhere. |
| `rename-writes.ts` | How many times a rename writes an entity's `updated_at`. |
| `qa-rename.ts` | Whether each side's live Quick Access skills or snippets list reaches what a reload shows after a rename. |
| `session-rename.ts` | When each side's Quick Access sessions list shows a rename, with the app's spans per phase. |
| `reload-blank.ts` | How often pages reloaded together come up blank, and what a blank one waits on. |
| `replay.ts` | One reader on both apps as an existing synthetic user, with every failed response. |
| `session-harness.ts` | The PR links panel's opener lookup on both apps: each row's tag, data keys and `harness`, raw and as the panel maps it. |
| `qa-rename-refresh.ts` | What an in-app rename does to the rest of each side's Quick Access skills or snippets, against a fresh load. |
| `boot-window.ts` | Whether a write from another device right after a reload reaches a generic Soup list, and where each side's cache engine started. |
| `qa-people-settle.ts` | When Quick Access's people rows arrive, against the `isLoading` the probe settles on. |

## Pieces

| File | Does |
| --- | --- |
| `run.ts` | One pass: builds worlds, runs the lanes through a bounded pool, writes one JSON. |
| `lib/world.ts` | Seeded synthetic worlds: users (owner, member, outsider, empty, page-boundary), a team, documents of every kind, projects, chats, sessions, initiatives, CRM companies, PRs, shares, history, odd names. |
| `lib/suite-fuzz.ts`, `lib/ast-gen.ts` | Translator fuzz: random Soup ASTs over the whole grammar; each case is REST's rows on both sides, or a traced `soup.rest_fallback` with the expected reason. |
| `lib/suite-callers.ts` | Every former caller and one-shot, mounted on both apps with generated params. |
| `lib/suite-seq.ts` | Stateful sequences: writes in the app and from other users, then reload, live and read-after-write comparisons against a truth page. |
| `lib/mutants.ts` | Mutants planted in the branch's read path; a pass with them must fail. |
| `lib/load.ts` | Concurrent REST/GraphQL reads and writes from a separate world. |
| `lib/compare.ts` | Field-by-field comparison and the named rules for differences callers can't see. |
| `probe/` | Mounts the real callers inside each app and exposes their output. |
| `netns.sh` | Runs a command in its own network namespace with the given localhost ports forwarded. |
| `summarize.ts` | Folds result files into one summary. |
| `against-aa.ts` | Each run's failure buckets against the A/A control's rates. |

Only synthetic data: every user is under `*.difftest.dev`. The auth service
allows 50 new users per address per hour, so `run.sh` resets that counter in the
local stack's Redis before each pass.
