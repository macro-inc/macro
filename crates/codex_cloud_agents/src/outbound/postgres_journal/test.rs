use super::*;
use uuid::Uuid;

#[sqlx::test(migrations = false)]
async fn journal_survives_takeover_and_rejects_stale_or_foreign_attachments(pool: PgPool) {
    tables(&pool).await;
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let replica = ReplicaId::from_uuid(Uuid::from_u128(2));
    let other = ReplicaId::from_uuid(Uuid::from_u128(3));
    let id = session.to_string();
    sqlx::query!(
        "INSERT INTO agent_session (id, manager_replica_id, manager_fence) VALUES ($1, $2, 1)",
        session.as_uuid(),
        replica.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    let journal = Arc::new(PgCodexJournal::new(pool.clone(), session, replica));
    assert!(journal.validate().await.is_err());
    assert!(journal.load(&id).await.is_err());
    assert!(journal.activate(session, other, ManagerFence(1)).is_err());
    journal.activate(session, replica, ManagerFence(1)).unwrap();
    assert!(journal.load(&id).await.unwrap().is_none());
    let state = StoredSession {
        task: Some("task-before-restart".into()),
        uncertain_write: true,
        ..StoredSession::default()
    };
    journal.save(&id, &state).await.unwrap();
    journal
        .append(&id, 0, None, &JournalInput::HistoryComplete)
        .await
        .unwrap();
    let turn = TurnId::new("task-before-restart~turn-1".into()).unwrap();
    journal
        .append(&id, 1, Some(&turn), &prompt("original prompt 🐺"))
        .await
        .unwrap();
    assert!(journal.read("another-session").await.is_err());
    assert!(
        journal
            .append("another-session", 2, None, &JournalInput::HistoryComplete)
            .await
            .is_err()
    );
    assert!(journal.load("another-session").await.is_err());
    assert!(journal.save("another-session", &state).await.is_err());
    let wrong_replica = Arc::new(PgCodexJournal::new(pool.clone(), session, other));
    wrong_replica
        .activate(session, other, ManagerFence(1))
        .unwrap();
    assert!(wrong_replica.validate().await.is_err());
    sqlx::query!(
        "UPDATE agent_session SET manager_fence = 2 WHERE id = $1",
        session.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(journal.validate().await.is_err());
    assert!(journal.load(&id).await.is_err());
    assert!(journal.read(&id).await.is_err());
    assert!(
        journal
            .append(&id, 2, None, &JournalInput::HistoryComplete)
            .await
            .is_err()
    );
    assert!(journal.save(&id, &StoredSession::default()).await.is_err());
    assert!(journal.activate(session, replica, ManagerFence(2)).is_err());
    let successor = Arc::new(PgCodexJournal::new(pool.clone(), session, replica));
    successor
        .activate(session, replica, ManagerFence(2))
        .unwrap();
    let inputs = successor.read(&id).await.unwrap();
    assert_eq!(inputs.len(), 2);
    assert_eq!(inputs[1].turn.as_ref().unwrap().as_str(), turn.as_str());
    assert_eq!(
        serde_json::to_value(&inputs[1].input).unwrap(),
        serde_json::to_value(prompt("original prompt 🐺")).unwrap()
    );
    let restored = successor.load(&id).await.unwrap().unwrap();
    assert_eq!(restored.task.as_deref(), Some("task-before-restart"));
    assert!(
        restored.uncertain_write,
        "restart must preserve the no-retry guard"
    );
    successor
        .save(&id, &StoredSession::default())
        .await
        .unwrap();
    assert!(successor.load(&id).await.unwrap().unwrap().task.is_none());
    assert_eq!(
        successor.read(&id).await.unwrap().len(),
        2,
        "metadata checkpoints cannot rewrite native history"
    );
    sqlx::query!("DELETE FROM agent_session WHERE id = $1", session.as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    let count = sqlx::query_scalar!("SELECT count(*) AS \"count!\" FROM codex_cloud_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    let native_count =
        sqlx::query_scalar!("SELECT count(*) AS \"count!\" FROM codex_journal_input")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(native_count, 0);
}

async fn tables(pool: &PgPool) {
    sqlx::raw_sql("CREATE TABLE agent_session(id uuid PRIMARY KEY, manager_replica_id uuid, manager_fence bigint NOT NULL)")
        .execute(pool).await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20260915231629_codex_cloud_session_journal.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20260915231630_codex_cloud_native_inputs.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
}

async fn active(pool: &PgPool) -> (Arc<PgCodexJournal>, String) {
    tables(pool).await;
    let session = AgentSessionId::new_from_uuid(Uuid::now_v7());
    let replica = ReplicaId::from_uuid(Uuid::now_v7());
    sqlx::query!(
        "INSERT INTO agent_session (id, manager_replica_id, manager_fence) VALUES ($1, $2, 1)",
        session.as_uuid(),
        replica.as_uuid()
    )
    .execute(pool)
    .await
    .unwrap();
    let journal = Arc::new(PgCodexJournal::new(pool.clone(), session, replica));
    journal.activate(session, replica, ManagerFence(1)).unwrap();
    let id = session.to_string();
    journal.save(&id, &StoredSession::default()).await.unwrap();
    (journal, id)
}

#[sqlx::test(migrations = false)]
async fn append_compares_sequence_under_the_same_owner_lock(pool: PgPool) {
    let (journal, id) = active(&pool).await;
    let input = JournalInput::HistoryComplete;
    let (first, second) = tokio::join!(
        journal.append(&id, 0, None, &input),
        journal.append(&id, 0, None, &input)
    );
    assert_ne!(first.is_ok(), second.is_ok());
    let entries = journal.read(&id).await.unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].sequence, 1);
    assert!(journal.append(&id, -1, None, &input).await.is_err());
    assert!(journal.append(&id, i64::MAX, None, &input).await.is_err());
    assert_eq!(journal.read(&id).await.unwrap().len(), 1);
}

#[sqlx::test(migrations = false)]
async fn native_read_rejects_gaps_instead_of_replaying_partial_history(pool: PgPool) {
    let (journal, id) = active(&pool).await;
    journal
        .append(&id, 0, None, &JournalInput::HistoryComplete)
        .await
        .unwrap();
    journal
        .append(&id, 1, None, &prompt("second"))
        .await
        .unwrap();
    sqlx::query!(
        "DELETE FROM codex_journal_input WHERE agent_session_id = $1 AND sequence = 1",
        journal.session.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    let error = journal.read(&id).await.err().unwrap().to_string();
    assert!(error.contains("sequence gap"));
}

#[sqlx::test(migrations = false)]
async fn unknown_native_payloads_roundtrip_verbatim_without_translation(pool: PgPool) {
    use crate::domain::cloud::NativeRecord;
    let (journal, id) = active(&pool).await;
    journal
        .append(&id, 0, None, &JournalInput::HistoryComplete)
        .await
        .unwrap();
    let raw = "  {\"unknown_future_field\": [1, 2], \"text\":\"🐺\\nsecond line\"}\n";
    let input = JournalInput::Native(NativeRecord {
        event: "future-event".into(),
        id: Some("provider-id".into()),
        data: raw.into(),
    });
    let turn = TurnId::new("task-a~turn-a".into()).unwrap();
    journal.append(&id, 1, Some(&turn), &input).await.unwrap();
    let rows = journal.read(&id).await.unwrap();
    let JournalInput::Native(record) = &rows[1].input else {
        panic!("expected native input")
    };
    assert_eq!(record.data, raw);
    assert_eq!(record.event, "future-event");
    assert_eq!(record.id.as_deref(), Some("provider-id"));
    assert_eq!(rows[1].turn.as_ref().unwrap().as_str(), turn.as_str());
    let malformed = JournalInput::Native(NativeRecord {
        event: String::new(),
        id: None,
        data: "not-json provider bytes 🐺".into(),
    });
    journal
        .append(&id, 2, Some(&turn), &malformed)
        .await
        .unwrap();
    let rows = journal.read(&id).await.unwrap();
    let JournalInput::Native(record) = &rows[2].input else {
        panic!("expected native input")
    };
    assert_eq!(
        record.data, "not-json provider bytes 🐺",
        "capture must precede provider JSON decoding"
    );
}

fn prompt(text: &str) -> JournalInput {
    use agent_client_protocol::schema::v1::{ContentBlock, TextContent};
    JournalInput::Prompt(vec![ContentBlock::Text(TextContent::new(text))])
}
