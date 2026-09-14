use super::*;
use uuid::Uuid;

/// Only the lock store mints locks; the test plays that role via the
/// crate-visible constructor re-exported for adapters' tests.
fn lock(session: AgentSessionId, token: i64) -> SessionLock {
    agent_session::testing::session_lock_for_test(session, token)
}

#[sqlx::test(migrations = false)]
async fn append_is_ordered_locked_and_session_scoped(pool: PgPool) {
    sqlx::raw_sql(
        "CREATE TABLE agent_session(id uuid PRIMARY KEY, manager_replica_id uuid, manager_fence bigint NOT NULL);
         CREATE TABLE agent_session_log(id uuid PRIMARY KEY, agent_session_id uuid NOT NULL REFERENCES agent_session(id));
         CREATE TABLE external_agent_session(agent_session_id uuid PRIMARY KEY REFERENCES agent_session(id));",
    ).execute(&pool).await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20260906060601_cursor_session_replay.up.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let other_session = AgentSessionId::new_from_uuid(Uuid::from_u128(3));
    let replica = Uuid::from_u128(2);
    sqlx::query!(
        "INSERT INTO agent_session (id, manager_replica_id, manager_fence) VALUES ($1, $2, 1)",
        session.as_uuid(),
        replica
    )
    .execute(&pool)
    .await
    .unwrap();
    let journal = PgCursorJournal::new(pool.clone(), session);
    let id = SessionId::new("acp");
    assert!(
        journal.read(&id).await.is_err(),
        "cannot operate before attachment activation"
    );
    assert!(journal.activate(lock(other_session, 1)).is_err());
    journal.activate(lock(session, 1)).unwrap();
    let stale_before_io = PgCursorJournal::new(pool.clone(), session);
    stale_before_io.activate(lock(session, 1)).unwrap();
    assert!(journal.read(&id).await.unwrap().is_empty());
    journal
        .append(&id, 0, None, &JournalInput::HistoryComplete)
        .await
        .unwrap();
    assert!(
        journal
            .append(&id, 0, None, &JournalInput::HistoryComplete)
            .await
            .is_err()
    );
    let run = CursorRunId::new("run-1");
    journal
        .append(&id, 1, Some(&run), &JournalInput::Poll("raw".into()))
        .await
        .unwrap();
    let rows = journal.read(&id).await.unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1].run.as_ref(), Some(&run));
    let timestamped = sqlx::query_scalar!(
        "SELECT count(*) AS \"count!\" FROM cursor_journal_input WHERE inserted_at IS NOT NULL AND inserted_at <= now()"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        timestamped, 2,
        "appends get a database timestamp by default"
    );
    let foreign = PgCursorJournal::new(pool.clone(), session);
    foreign.activate(lock(session, 7)).unwrap();
    assert!(
        foreign.read(&id).await.is_err(),
        "a lock with the wrong token is not the session's lock"
    );
    sqlx::query!(
        "UPDATE agent_session SET manager_fence = 2 WHERE id = $1",
        session.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        journal.read(&id).await.is_err(),
        "read after takeover fails"
    );
    assert!(
        journal
            .append(&id, 2, None, &JournalInput::HistoryComplete)
            .await
            .is_err()
    );
    assert!(
        stale_before_io.read(&id).await.is_err(),
        "A's first IO must not adopt same-replica successor generation"
    );
    assert!(
        stale_before_io
            .append(&id, 2, None, &JournalInput::HistoryComplete)
            .await
            .is_err()
    );
    assert!(
        stale_before_io.activate(lock(session, 2)).is_err(),
        "cannot rebind old connection"
    );
    let successor = PgCursorJournal::new(pool.clone(), session);
    successor.activate(lock(session, 2)).unwrap();
    assert_eq!(successor.read(&id).await.unwrap().len(), 2);
    successor
        .append(&id, 2, Some(&run), &JournalInput::Reconciled)
        .await
        .unwrap();
    let (first, second) = tokio::join!(
        successor.append(&id, 3, None, &JournalInput::HistoryComplete),
        successor.append(&id, 3, None, &JournalInput::HistoryComplete),
    );
    assert_ne!(first.is_ok(), second.is_ok(), "only one append can win");
    assert_eq!(successor.read(&id).await.unwrap().len(), 4);
    sqlx::query!("DELETE FROM agent_session WHERE id = $1", session.as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar!("SELECT count(*) AS \"count!\" FROM cursor_journal_input")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);

    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20260906060601_cursor_session_replay.down.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20260906060601_cursor_session_replay.up.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
}
