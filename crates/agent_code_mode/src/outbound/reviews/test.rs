use super::*;
use crate::{
    domain::{ExecutionRecord, ExecutionStatus, ExecutionStore},
    outbound::postgres::PgExecutionStore,
};
use serde_json::json;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn review_revision_claim_is_atomic_and_session_deletion_removes_reviews(pool: PgPool) {
    sqlx::raw_sql(include_str!("../postgres/test/sessions.sql"))
        .execute(&pool)
        .await
        .unwrap();
    let session = AgentSessionId::new_from_uuid(macro_uuid::Uuid::from_u128(1));
    let other = AgentSessionId::new_from_uuid(macro_uuid::Uuid::from_u128(2));
    let execution = ExecutionId::mint();
    PgExecutionStore::new(pool.clone())
        .create(
            session,
            &ExecutionRecord {
                execution_id: execution,
                source: String::new(),
                status: ExecutionStatus::Running,
                result: None,
                error: None,
                calls: vec![],
                activity: Vec::new(),
                activity_truncated: false,
            },
        )
        .await
        .unwrap();
    let store = PgReviewStore(pool.clone());
    let mut record = ReviewRecord {
        id: ReviewId(macro_uuid::generate_uuid_v7()),
        session_id: session,
        execution_id: Some(execution),
        presented_at: None,
        kind: ReviewKind::Email,
        title: "Pick one".into(),
        revision: 0,
        updated_at: 0,
        notification_id: None,
        notification_attempt_at: None,
        items: vec![ReviewItem {
            id: macro_uuid::generate_uuid_v7(),
            draft: json!({"subject":"Which?"}),
            status: ReviewItemStatus::Pending,
            result: None,
            error: None,
        }],
    };
    store.create(&record, 100).await.unwrap();
    let mut second = record.clone();
    second.id = ReviewId(macro_uuid::generate_uuid_v7());
    let mut third = record.clone();
    third.id = ReviewId(macro_uuid::generate_uuid_v7());
    let (second_result, third_result) =
        tokio::join!(store.create(&second, 2), store.create(&third, 2));
    assert_eq!(
        usize::from(second_result.is_ok()) + usize::from(third_result.is_ok()),
        1
    );
    assert!(matches!(
        second_result.err().or(third_result.err()),
        Some(CodeModeError::Invalid(_))
    ));
    assert_eq!(store.list(session, execution).await.unwrap().len(), 2);
    assert!(matches!(
        store.get(other, record.id).await,
        Err(CodeModeError::NotFound)
    ));
    assert!(store.list(other, execution).await.unwrap().is_empty());
    let mut standalone = record.clone();
    standalone.id = ReviewId(macro_uuid::generate_uuid_v7());
    standalone.execution_id = None;
    assert!(matches!(
        store.create(&standalone, 2).await,
        Err(CodeModeError::Invalid(_))
    ));
    store.create(&standalone, 3).await.unwrap();
    assert!(
        store
            .get(session, standalone.id)
            .await
            .unwrap()
            .execution_id
            .is_none()
    );
    record.revision = 1;
    record.items[0].status = ReviewItemStatus::Submitting;
    let (first, second) = tokio::join!(store.save(0, &record), store.save(0, &record));
    assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
    assert!(matches!(
        first.err().or(second.err()),
        Some(CodeModeError::Conflict)
    ));
    let persisted = PgReviewStore(pool.clone())
        .get(session, record.id)
        .await
        .unwrap();
    assert_eq!(persisted.revision, 1);
    assert_eq!(persisted.items[0].status, ReviewItemStatus::Submitting);
    sqlx::raw_sql("DELETE FROM agent_session WHERE id = '00000000-0000-0000-0000-000000000001'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        store.get(session, record.id).await,
        Err(CodeModeError::NotFound)
    ));
}
