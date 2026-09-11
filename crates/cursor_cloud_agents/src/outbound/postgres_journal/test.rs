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

/// A normal session-log writer must not invalidate the native journal.
/// After contention, the journal must still check the committed generation.
#[sqlx::test(migrations = false)]
async fn contention_waits_then_checks_the_claim(pool: PgPool) {
    sqlx::raw_sql(
        "CREATE TABLE agent_session(id uuid PRIMARY KEY, manager_replica_id uuid, manager_fence bigint NOT NULL)",
    ).execute(&pool).await.unwrap();
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let replica = ReplicaId::from_uuid(Uuid::from_u128(2));
    sqlx::query!(
        "INSERT INTO agent_session (id, manager_replica_id, manager_fence) VALUES ($1, $2, 1)",
        session.as_uuid(),
        replica.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    let journal = PgCursorJournal::new(pool.clone(), session, replica);
    journal.activate(session, replica, ManagerFence(1)).unwrap();

    // A writer retaining the same claim can hold this lock legitimately.
    let mut writer = pool.begin().await.unwrap();
    sqlx::query!(
        "UPDATE agent_session SET manager_fence = 1 WHERE id = $1",
        session.as_uuid()
    )
    .execute(&mut *writer)
    .await
    .unwrap();
    let acquiring = journal.begin_owned();
    tokio::pin!(acquiring);
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut acquiring)
            .await
            .is_err()
    );
    writer.commit().await.unwrap();
    acquiring
        .await
        .expect("same owner can continue after contention")
        .commit()
        .await
        .unwrap();

    // A takeover must be checked after it commits, not inferred from the lock.
    let mut takeover = pool.begin().await.unwrap();
    sqlx::query!(
        "UPDATE agent_session SET manager_fence = 2 WHERE id = $1",
        session.as_uuid()
    )
    .execute(&mut *takeover)
    .await
    .unwrap();
    let acquiring = journal.begin_owned();
    tokio::pin!(acquiring);
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut acquiring)
            .await
            .is_err()
    );
    takeover.commit().await.unwrap();
    let error = acquiring.await.unwrap_err();
    assert!(error.to_string().contains("writer fenced out"));
}

#[sqlx::test(migrations = false)]
async fn persistent_contention_is_bounded_and_not_reported_as_a_takeover(pool: PgPool) {
    sqlx::raw_sql(
        "CREATE TABLE agent_session(id uuid PRIMARY KEY, manager_replica_id uuid, manager_fence bigint NOT NULL)",
    ).execute(&pool).await.unwrap();
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let replica = ReplicaId::from_uuid(Uuid::from_u128(2));
    sqlx::query!(
        "INSERT INTO agent_session (id, manager_replica_id, manager_fence) VALUES ($1, $2, 1)",
        session.as_uuid(),
        replica.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    let journal = PgCursorJournal::new(pool.clone(), session, replica);
    journal.activate(session, replica, ManagerFence(1)).unwrap();
    let mut writer = pool.begin().await.unwrap();
    sqlx::query!(
        "UPDATE agent_session SET manager_fence = 1 WHERE id = $1",
        session.as_uuid()
    )
    .execute(&mut *writer)
    .await
    .unwrap();
    let error = tokio::time::timeout(
        OWNER_LOCK_TIMEOUT + Duration::from_secs(1),
        journal.begin_owned(),
    )
    .await
    .expect("contention must have a deadline")
    .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("timed out waiting for the session lock")
    );
    writer.rollback().await.unwrap();
    journal.begin_owned().await.unwrap().commit().await.unwrap();
}
