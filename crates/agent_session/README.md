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
