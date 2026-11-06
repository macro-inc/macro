use super::*;
use crate::outbound::pg_activity_repo::{insert_activities, purge_entities};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn transactional_activity_writes_follow_commit_and_rollback(pool: PgPool) {
    let event = seed(71, CommonAction::Edited, "transactional-document");
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
    assert_eq!(
        repo.entity_feed(EntityType::Document, "transactional-document", None, nz(10))
            .await
            .unwrap()
            .records
            .len(),
        1
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
