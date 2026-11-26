use super::*;
use crate::domain::models::AppearanceChange;
use crate::outbound::pg_activity_repo::{
    appearance_changes_exceed, insert_activities, purge_entities,
};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn transactional_activity_writes_follow_commit_and_rollback(pool: PgPool) {
    let correlation = Uuid::now_v7();
    let event = agent_correlation::context::scope_with_verb(
        Some(correlation),
        Some(agent_correlation::AgentVerb::Edited),
        async { seed(71, CommonAction::Edited, "transactional-document") },
    )
    .await;
    let repo = PgActivityRepo::new(pool.clone());
    let mut transaction = pool.begin().await.unwrap();
    insert_activities(&mut *transaction, &[event.clone()])
        .await
        .unwrap();
    transaction.rollback().await.unwrap();
    assert!(
        repo.entity_feed(EntityType::Document, "transactional-document", None, nz(10))
            .await
            .unwrap()
            .records
            .is_empty()
    );

    let mut transaction = pool.begin().await.unwrap();
    insert_activities(&mut *transaction, &[event.clone(), event])
        .await
        .unwrap();
    transaction.commit().await.unwrap();
    let page = repo
        .entity_feed(EntityType::Document, "transactional-document", None, nz(10))
        .await
        .unwrap();
    assert_eq!(page.records.len(), 1);
    assert_eq!(page.records[0].agent_correlation_id, Some(correlation));
    assert_eq!(
        page.records[0].agent_verb,
        Some(agent_correlation::AgentVerb::Edited)
    );
    let keys = [(EntityType::Document, "transactional-document".to_string())];
    let mut transaction = pool.begin().await.unwrap();
    purge_entities(&mut *transaction, &keys).await.unwrap();
    transaction.rollback().await.unwrap();
    assert_eq!(
        repo.entity_feed(EntityType::Document, "transactional-document", None, nz(10))
            .await
            .unwrap()
            .records
            .len(),
        1
    );
    let mut transaction = pool.begin().await.unwrap();
    purge_entities(&mut *transaction, &keys).await.unwrap();
    transaction.commit().await.unwrap();
    assert!(
        repo.entity_feed(EntityType::Document, "transactional-document", None, nz(10))
            .await
            .unwrap()
            .records
            .is_empty()
    );
}

fn routine_activity(source_event: u128, routine: &str, action: CommonAction) -> Activity {
    Activity::common(
        Uuid::from_u128(source_event),
        0,
        Actor::new_from_user(user("macro|actor@example.com")),
        None,
        EntityType::ScheduledAction,
        routine,
        action,
        Utc::now(),
    )
}

fn appearance_changed() -> CommonAction {
    CommonAction::AppearanceChanged(AppearanceChange {
        from: None,
        to: None,
    })
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn appearance_changes_exceed_counts_only_the_entitys_appearance_changes(pool: PgPool) {
    let routine = "0192f0a0-0000-7000-8000-000000000001";
    let exceeds = |known| {
        let pool = pool.clone();
        async move {
            appearance_changes_exceed(&pool, EntityType::ScheduledAction, routine, known)
                .await
                .unwrap()
        }
    };
    assert!(!exceeds(0).await, "no history");

    insert_activities(
        &pool,
        &[
            routine_activity(81, routine, CommonAction::Edited),
            routine_activity(
                82,
                "0192f0a0-0000-7000-8000-000000000002",
                appearance_changed(),
            ),
            seed(83, appearance_changed(), routine),
        ],
    )
    .await
    .unwrap();
    assert!(
        !exceeds(0).await,
        "another action, another routine, or another entity type with the same id"
    );

    insert_activities(
        &pool,
        &[
            routine_activity(84, routine, appearance_changed()),
            routine_activity(85, routine, appearance_changed()),
        ],
    )
    .await
    .unwrap();
    assert!(exceeds(0).await, "two changes, none known");
    assert!(exceeds(1).await, "two changes, one known");
    assert!(!exceeds(2).await, "two changes, both known");
    assert!(!exceeds(5).await, "two changes, more known");

    let mut transaction = pool.begin().await.unwrap();
    insert_activities(
        &mut *transaction,
        &[routine_activity(86, routine, appearance_changed())],
    )
    .await
    .unwrap();
    assert!(
        appearance_changes_exceed(&mut *transaction, EntityType::ScheduledAction, routine, 2)
            .await
            .unwrap(),
        "a change the transaction recorded"
    );
    transaction.rollback().await.unwrap();
    assert!(!exceeds(2).await, "the change rolled back");
}
