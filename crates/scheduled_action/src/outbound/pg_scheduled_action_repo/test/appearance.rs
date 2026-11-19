use super::*;
use crate::domain::appearance::{AppearanceChooser, ChangeAppearance};
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
        chooser: AppearanceChooser::Owner,
        attribution: Attribution::direct(Actor::new_from_user(user(USER_A))),
        event_id: macro_uuid::generate_uuid_v7(),
        occurred_at: Utc::now(),
    };
    assert!(repo.set_appearance(change).await.unwrap().is_some());
    assert!(
        repo.set_appearance(ChangeAppearance {
            id,
            appearance: appearance.clone(),
            chooser: AppearanceChooser::Owner,
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
            chooser: AppearanceChooser::Owner,
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

fn change(id: Uuid, appearance: EntityAppearance, chooser: AppearanceChooser) -> ChangeAppearance {
    ChangeAppearance {
        id,
        appearance,
        chooser,
        attribution: Attribution::direct(Actor::new_from_user(user(USER_A))),
        event_id: macro_uuid::generate_uuid_v7(),
        occurred_at: Utc::now(),
    }
}

fn colored(color: AppearanceColor) -> EntityAppearance {
    EntityAppearance {
        icon: None,
        color: Some(color),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn agent_picks_until_the_owner_chooses(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let created = repo
        .create_action(sample_action(user_owner(USER_A), "routine"))
        .await
        .unwrap();
    let id = created.id.unwrap();

    let first = colored(AppearanceColor::Blue);
    assert!(
        repo.set_appearance(change(id, first.clone(), AppearanceChooser::Agent))
            .await
            .unwrap()
            .is_some()
    );
    let second = colored(AppearanceColor::Green);
    assert!(
        repo.set_appearance(change(id, second.clone(), AppearanceChooser::Agent))
            .await
            .unwrap()
            .is_some(),
        "an agent may pick again while the owner has not chosen"
    );
    assert_eq!(
        repo.get_action(&id).await.unwrap().unwrap().appearance,
        second
    );

    let chosen = colored(AppearanceColor::Red);
    assert!(
        repo.set_appearance(change(id, chosen.clone(), AppearanceChooser::Owner))
            .await
            .unwrap()
            .is_some()
    );
    assert!(
        repo.set_appearance(change(id, first, AppearanceChooser::Agent))
            .await
            .unwrap()
            .is_none(),
        "an agent never replaces the owner's choice"
    );
    assert_eq!(
        repo.get_action(&id).await.unwrap().unwrap().appearance,
        chosen
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn choosing_the_current_look_still_keeps_it(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let created = repo
        .create_action(sample_action(user_owner(USER_A), "routine"))
        .await
        .unwrap();
    let id = created.id.unwrap();

    // The owner picks "no icon", which the routine already has: nothing to
    // record, but an agent may no longer give it one.
    assert!(
        repo.set_appearance(change(
            id,
            EntityAppearance::default(),
            AppearanceChooser::Owner
        ))
        .await
        .unwrap()
        .is_none()
    );
    assert!(
        repo.set_appearance(change(
            id,
            colored(AppearanceColor::Blue),
            AppearanceChooser::Agent
        ))
        .await
        .unwrap()
        .is_none()
    );
    assert_eq!(
        repo.get_action(&id).await.unwrap().unwrap().appearance,
        EntityAppearance::default()
    );
    let history = activity::outbound::pg_activity_repo::PgActivityRepo::new(pool);
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

const MARK_OWNER_CHOSEN_SQL: &str = include_str!(
    "../../../../../../crates/macro_db_client/migrations/20261118201451_mark_owner_chosen_routine_appearances.sql"
);

async fn chosen_by_owner(pool: &PgPool, id: Uuid) -> bool {
    sqlx::query_scalar!(
        "SELECT appearance_chosen_by_owner FROM scheduled_action WHERE id = $1",
        id,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Puts a routine back as it was before `appearance_chosen_by_owner`: its
/// look as stored, and no choice recorded.
async fn as_before_the_column(pool: &PgPool, id: Uuid, appearance: Option<serde_json::Value>) {
    sqlx::query!(
        "UPDATE scheduled_action SET appearance = $2, appearance_chosen_by_owner = false WHERE id = $1",
        id,
        appearance,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_backfill_marks_every_look_the_owner_set_before_the_column(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let mut routines = Vec::new();
    for name in ["colored", "reset", "never", "blank"] {
        let created = repo
            .create_action(sample_action(user_owner(USER_A), name))
            .await
            .unwrap();
        routines.push(created.id.unwrap());
    }
    let [colored_one, reset, never, blank] = routines[..] else {
        panic!("four routines were created");
    };
    as_before_the_column(&pool, colored_one, Some(json!({ "color": "blue" }))).await;
    // Reset to no icon through the endpoint, which recorded both changes.
    for look in [colored(AppearanceColor::Red), EntityAppearance::default()] {
        repo.set_appearance(change(reset, look, AppearanceChooser::Owner))
            .await
            .unwrap();
    }
    as_before_the_column(&pool, reset, None).await;
    as_before_the_column(&pool, never, None).await;
    as_before_the_column(&pool, blank, Some(json!({ "icon": null, "color": null }))).await;

    for _ in 0..2 {
        sqlx::raw_sql(MARK_OWNER_CHOSEN_SQL)
            .execute(&pool)
            .await
            .unwrap();
        assert!(chosen_by_owner(&pool, colored_one).await, "a look it has");
        assert!(chosen_by_owner(&pool, reset).await, "a look reset to none");
        assert!(!chosen_by_owner(&pool, never).await, "never given a look");
        assert!(
            !chosen_by_owner(&pool, blank).await,
            "a look with nothing in it"
        );
    }
}
