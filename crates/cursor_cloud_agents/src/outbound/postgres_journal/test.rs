use super::*;

#[sqlx::test(migrations = false)]
async fn append_is_ordered_fenced_and_session_scoped(pool: PgPool) {
    sqlx::raw_sql("CREATE TABLE agent_session(id uuid PRIMARY KEY, manager_replica_id uuid, manager_fence bigint NOT NULL);").execute(&pool).await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20260906040140_cursor_native_journal.up.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    let session = Uuid::from_u128(1);
    let replica = Uuid::from_u128(2);
    let other = Uuid::from_u128(3);
    sqlx::query!(
        "INSERT INTO agent_session (id, manager_replica_id, manager_fence) VALUES ($1, $2, 1)",
        session,
        replica
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
    journal.activate(session, replica, 1).unwrap();
    let stale_before_io = PgCursorJournal::new(pool.clone(), session, replica);
    stale_before_io.activate(session, replica, 1).unwrap();
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
    let foreign = PgCursorJournal::new(pool.clone(), session, other);
    foreign.activate(session, other, 1).unwrap();
    assert!(
        foreign.read(&id).await.is_err(),
        "must not adopt another replica's fence"
    );
    sqlx::query!(
        "UPDATE agent_session SET manager_fence = 2 WHERE id = $1",
        session
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
        stale_before_io.activate(session, replica, 2).is_err(),
        "cannot rebind old connection"
    );
    let successor = PgCursorJournal::new(pool.clone(), session, replica);
    successor.activate(session, replica, 2).unwrap();
    assert_eq!(successor.read(&id).await.unwrap().len(), 2);
    successor
        .append(&id, 2, Some(&run), &JournalInput::Reconciled)
        .await
        .unwrap();
    sqlx::query!("DELETE FROM agent_session WHERE id = $1", session)
        .execute(&pool)
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar!("SELECT count(*) AS \"count!\" FROM cursor_journal_input")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}
