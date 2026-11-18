use super::*;
use crate::domain::appearance::ChangeAppearance;
use activity::domain::ports::{ActivityReads, EntityActivityReads};
use activity::{Action, Actor, Attribution, RecordedAction};
use model_entity::{AppearanceColor, EntityAppearance};
use std::num::NonZeroU32;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn appearance_and_history_commit_without_changing_scheduling(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let created = repo
        .create_action(sample_action(user_owner(USER_A), "routine"))
        .await
        .unwrap();
    let id = created.id.unwrap();
    repo.claim_action(&id, created.configuration_revision, created.next_run_at)
        .await
        .unwrap();
    let before = repo.get_action(&id).await.unwrap().unwrap();
    let appearance = EntityAppearance {
        icon: None,
        color: Some(AppearanceColor::Blue),
    };
    let change = ChangeAppearance {
        id,
        appearance: appearance.clone(),
        attribution: Attribution::direct(Actor::new_from_user(user(USER_A))),
        event_id: macro_uuid::generate_uuid_v7(),
        occurred_at: Utc::now(),
    };
    assert!(repo.set_appearance(change).await.unwrap().is_some());
    assert!(
        repo.set_appearance(ChangeAppearance {
            id,
            appearance: appearance.clone(),
            attribution: Attribution::direct(Actor::new_from_user(user(USER_A))),
            event_id: macro_uuid::generate_uuid_v7(),
            occurred_at: Utc::now(),
        })
        .await
        .unwrap()
        .is_none()
    );

    let after = repo.get_action(&id).await.unwrap().unwrap();
    assert_eq!(after.appearance, appearance);
    assert_eq!(after.updated_at, before.updated_at);
    assert_eq!(after.created_at, before.created_at);
    assert_eq!(after.configuration_revision, before.configuration_revision);
    assert_eq!(after.next_run_at, before.next_run_at);
    assert_eq!(after.claimed, before.claimed);
    assert_eq!(after.event_activated_at, before.event_activated_at);
    assert_eq!(after.enabled, before.enabled);
    let history = activity::outbound::pg_activity_repo::PgActivityRepo::new(pool);
    let records = history
        .entity_feed(
            model_entity::EntityType::ScheduledAction,
            &id.to_string(),
            None,
            NonZeroU32::new(10).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(records.records.len(), 1);
    assert!(matches!(
        records.records[0].action,
        RecordedAction::Known(Action::AppearanceChanged(_))
    ));
    assert!(
        history
            .subject_feed(USER_A, None, NonZeroU32::new(10).unwrap())
            .await
            .unwrap()
            .records
            .is_empty()
    );
    repo.delete_action(&id).await.unwrap();
    assert!(
        history
            .entity_feed(
                model_entity::EntityType::ScheduledAction,
                &id.to_string(),
                None,
                NonZeroU32::new(10).unwrap(),
            )
            .await
            .unwrap()
            .records
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn history_failure_rolls_back_the_appearance(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let created = repo
        .create_action(sample_action(user_owner(USER_A), "routine"))
        .await
        .unwrap();
    let id = created.id.unwrap();
    // Inject a history failure in this isolated test database to verify atomic rollback.
    sqlx::query!("ALTER TABLE activity_events ADD CONSTRAINT refuse_appearance_test CHECK (action <> 'appearance_changed')")
        .execute(&pool).await.unwrap();
    assert!(
        repo.set_appearance(ChangeAppearance {
            id,
            appearance: EntityAppearance {
                icon: None,
                color: Some(AppearanceColor::Blue)
            },
            attribution: Attribution::direct(Actor::new_from_user(user(USER_A))),
            event_id: macro_uuid::generate_uuid_v7(),
            occurred_at: Utc::now(),
        })
        .await
        .is_err()
    );
    let stored = repo.get_action(&id).await.unwrap().unwrap();
    assert_eq!(stored.appearance, created.appearance);
    assert_eq!(stored.updated_at, created.updated_at);
}
