use super::*;
use crate::domain::ExecutionStatus;
use serde_json::json;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn records_survive_reconnection_and_remain_scoped_to_their_session(pool: PgPool) {
    sqlx::raw_sql(include_str!("test/sessions.sql"))
        .execute(&pool)
        .await
        .unwrap();
    let session = AgentSessionId::new_from_uuid(macro_uuid::Uuid::from_u128(1));
    let other = AgentSessionId::new_from_uuid(macro_uuid::Uuid::from_u128(2));
    let record = ExecutionRecord {
        execution_id: ExecutionId::mint(),
        source: "return 42;".into(),
        status: ExecutionStatus::Succeeded,
        result: Some(json!(42)),
        error: None,
        calls: Vec::new(),
    };
    let store = PgExecutionStore::new(pool.clone());
    store.create(session, &record).await.unwrap();
    assert!(matches!(
        store.get(other, record.execution_id).await,
        Err(CodeModeError::NotFound)
    ));
    assert!(matches!(
        store.save(other, &record).await,
        Err(CodeModeError::NotFound)
    ));
    let mut late_write = record.clone();
    late_write.status = ExecutionStatus::Running;
    late_write.result = None;
    assert!(store.save(session, &late_write).await.is_err());
    assert!(matches!(
        store.create(session, &record).await,
        Err(CodeModeError::Duplicate)
    ));
    drop(store);
    let reconnected = PgExecutionStore::new(pool.clone());
    assert_eq!(
        reconnected
            .get(session, record.execution_id)
            .await
            .unwrap()
            .result,
        Some(json!(42))
    );
    // Session deletion must remove its data, including source and inner results.
    sqlx::raw_sql("DELETE FROM agent_session WHERE id = '00000000-0000-0000-0000-000000000001'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        reconnected.get(session, record.execution_id).await,
        Err(CodeModeError::NotFound)
    ));
}
