use super::*;
use uuid::Uuid;

#[sqlx::test(migrations = false)]
async fn append_is_ordered_fenced_and_session_scoped(pool: PgPool) {
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
    let replica = ReplicaId::from_uuid(Uuid::from_u128(2));
    let other = ReplicaId::from_uuid(Uuid::from_u128(3));
    sqlx::query!(
        "INSERT INTO agent_session (id, manager_replica_id, manager_fence) VALUES ($1, $2, 1)",
        session.as_uuid(),
        replica.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    let journal = PgCursorJournal::new(pool.clone(), session, replica);
    let id = SessionId::new("acp");
    assert!(
        journal.read(&id).await.is_err(),
        "cannot operate before attachment activation"
    );
    assert!(journal.activate(session, other, ManagerFence(1)).is_err());
    journal.activate(session, replica, ManagerFence(1)).unwrap();
    let stale_before_io = PgCursorJournal::new(pool.clone(), session, replica);
    stale_before_io
        .activate(session, replica, ManagerFence(1))
        .unwrap();
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
    let foreign = PgCursorJournal::new(pool.clone(), session, other);
    foreign.activate(session, other, ManagerFence(1)).unwrap();
    assert!(
        foreign.read(&id).await.is_err(),
        "must not adopt another replica's fence"
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
        stale_before_io
            .activate(session, replica, ManagerFence(2))
            .is_err(),
        "cannot rebind old connection"
    );
    let successor = PgCursorJournal::new(pool.clone(), session, replica);
    successor
        .activate(session, replica, ManagerFence(2))
        .unwrap();
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

/// The tables the journal touches, and one claimed session in them.
async fn seed_claimed_session(pool: &PgPool, session: AgentSessionId, replica: ReplicaId) {
    sqlx::raw_sql(
        "CREATE TABLE agent_session(id uuid PRIMARY KEY, manager_replica_id uuid, manager_fence bigint NOT NULL);
         CREATE TABLE agent_session_log(id uuid PRIMARY KEY, agent_session_id uuid NOT NULL REFERENCES agent_session(id));
         CREATE TABLE external_agent_session(agent_session_id uuid PRIMARY KEY REFERENCES agent_session(id));",
    ).execute(pool).await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20260906060601_cursor_session_replay.up.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO agent_session (id, manager_replica_id, manager_fence) VALUES ($1, $2, 1)",
        session.as_uuid(),
        replica.as_uuid()
    )
    .execute(pool)
    .await
    .unwrap();
}

/// Lock the session row the way the session actor's fenced log write does:
/// `FOR UPDATE` under the current claim, held until the transaction ends.
async fn lock_row_like_the_log_writer(
    pool: &PgPool,
    session: AgentSessionId,
    replica: ReplicaId,
) -> sqlx::Transaction<'static, sqlx::Postgres> {
    let mut holder = pool.begin().await.unwrap();
    let locked = sqlx::query_scalar!(
        "SELECT id FROM agent_session WHERE id = $1 AND manager_replica_id = $2 AND manager_fence = 1 FOR UPDATE",
        session.as_uuid(),
        replica.as_uuid()
    )
    .fetch_optional(&mut *holder)
    .await
    .unwrap();
    assert!(
        locked.is_some(),
        "the holder must own the row for the test to mean anything"
    );
    holder
}

/// During a streaming turn the session actor logs each frame under a
/// `FOR UPDATE` of the same row the journal fences on, concurrently with the
/// append that produced the frame. That contention is routine and must be
/// waited out, not reported as a lost claim.
#[sqlx::test(migrations = false)]
async fn append_waits_out_a_sibling_writer_instead_of_failing(pool: PgPool) {
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let replica = ReplicaId::from_uuid(Uuid::from_u128(2));
    seed_claimed_session(&pool, session, replica).await;
    let journal = PgCursorJournal::new(pool.clone(), session, replica);
    journal.activate(session, replica, ManagerFence(1)).unwrap();
    let id = SessionId::new("acp");

    let holder = lock_row_like_the_log_writer(&pool, session, replica).await;
    let appending = tokio::spawn({
        let journal = PgCursorJournal::new(pool.clone(), session, replica);
        journal.activate(session, replica, ManagerFence(1)).unwrap();
        async move {
            journal
                .append(&id, 0, None, &JournalInput::HistoryComplete)
                .await
        }
    });
    // Blocked behind the holder, and still alive: neither an error nor a
    // result until the holder lets go.
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(300), appending)
            .await
            .is_err(),
        "an append must wait for a sibling writer rather than fail"
    );
    // `appending` was consumed by the timeout; the task itself is still
    // running. Release the row and check its outcome through the table.
    holder.commit().await.unwrap();
    let mut rows = 0;
    for _ in 0..50 {
        rows = sqlx::query_scalar!("SELECT count(*) AS \"count!\" FROM cursor_journal_input")
            .fetch_one(&pool)
            .await
            .unwrap();
        if rows == 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert_eq!(
        rows, 1,
        "the append must land once the sibling writer commits"
    );
    assert_eq!(journal.read(&SessionId::new("acp")).await.unwrap().len(), 1);
}

/// The wait is what makes a superseding claim visible: once the holder that
/// bumped the fence commits, the blocked writer re-reads the row and loses.
#[sqlx::test(migrations = false)]
async fn append_blocked_behind_a_takeover_is_fenced_once_it_commits(pool: PgPool) {
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let replica = ReplicaId::from_uuid(Uuid::from_u128(2));
    seed_claimed_session(&pool, session, replica).await;
    let id = SessionId::new("acp");

    let mut takeover = lock_row_like_the_log_writer(&pool, session, replica).await;
    sqlx::query!(
        "UPDATE agent_session SET manager_fence = 2 WHERE id = $1",
        session.as_uuid()
    )
    .execute(&mut *takeover)
    .await
    .unwrap();
    let appending = tokio::spawn({
        let journal = PgCursorJournal::new(pool.clone(), session, replica);
        journal.activate(session, replica, ManagerFence(1)).unwrap();
        async move {
            journal
                .append(&id, 0, None, &JournalInput::HistoryComplete)
                .await
        }
    });
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    takeover.commit().await.unwrap();
    let outcome = appending.await.unwrap();
    assert!(
        outcome
            .as_ref()
            .is_err_and(|error| error.to_string().contains("fenced out")),
        "a superseded writer must lose on the fence, got {outcome:?}"
    );
    let rows: i64 = sqlx::query_scalar!("SELECT count(*) AS \"count!\" FROM cursor_journal_input")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, 0);
}
