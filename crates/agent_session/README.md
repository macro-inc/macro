# Agent session activity projection

`agent_session.turn_state` is a list projection of the authoritative ACP fold.
The live writer commits each changed state with its log frame under the session's
ownership fence. Streamed tokens do not trigger repeated projection writes.

Apply migrations before deploying the writer. For sessions created before the
projection existed, run the bounded backfill against the intended MacroDB:

```bash
cargo build -p agent_session --features cli --bin backfill_turn_states
target/debug/backfill_turn_states --database-url "$DATABASE_URL" --limit 100
```

Repeat the second command until it reports `examined=0`. Each invocation folds
at most 100 session histories. It uses the same fold as the live writer and
initializes only missing projections, checking the latest log cursor while
holding the session lock. A concurrent append or projection causes that session
to be skipped; rerunning is safe. It does not change logs or session timestamps.

## Runtime working branches

`agent_session.working_branch` stores the branch a provider actually reports for
the session's configured repository. It is independent of `repo_branch`, which
is only the selected starting branch, and of whether a pull request exists.
Changing the configured repository clears the working branch. Writes check the
owner, repository, and active runtime claim; changed facts invalidate list rows.
Malformed or unrelated provider git metadata is ignored without blocking the
session's transcript or history replay.

Deploy the additive `agent_session_working_branch` migration before the agent
harness and document storage services. The harness persists the provider facts;
document storage returns them in the existing Soup `workingBranch` field. Deploy
both backend services before relying on that field in a frontend preview.

Cursor terminal result events supply the pushed branch, including when no PR was
opened. Replaying a saved Cursor native journal restores historical branch facts
when that journal contains them. Sessions without such a result remain unknown
until the provider reports one; loading the list does not launch an agent. Other
harnesses do not currently publish authoritative working branch facts. Soup
retains the last captured linked-PR branch as a fallback for those sessions and
older rows only while its captured repository matches the session's current one;
it never substitutes the starting branch.
