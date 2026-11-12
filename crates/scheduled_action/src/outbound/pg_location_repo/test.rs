use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::generate_uuid_v7;
use serde_json::json;
use sqlx::PgPool;

use super::*;
use crate::domain::event_trigger::ActionTrigger;
use crate::domain::location::{LocationTransition, fences};
use crate::domain::ports::ScheduledActionRepo;
use crate::outbound::pg_scheduled_action_repo::test::{
    USER_A, USER_B, insert_user, sample_action, test_repo, user_owner,
};

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn devices_are_found_by_token_and_removed_only_by_their_owner(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgLocationRepo::new(pool);
    let device = generate_uuid_v7();
    let token_hash = [7_u8; 32];

    repo.create_device(device, &user(USER_A), &token_hash)
        .await
        .unwrap();
    assert_eq!(
        repo.device_owner(&token_hash).await.unwrap(),
        Some(user(USER_A))
    );
    assert_eq!(repo.device_owner(&[8_u8; 32]).await.unwrap(), None);

    assert!(!repo.delete_device(device, &user(USER_B)).await.unwrap());
    assert!(repo.delete_device(device, &user(USER_A)).await.unwrap());
    assert_eq!(repo.device_owner(&token_hash).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn location_routines_round_trip_and_fire_once_per_cooldown(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let actions = test_repo(pool.clone());
    let mut action = sample_action(user_owner(USER_A), "Office arrival");
    action.trigger = serde_json::from_value(json!({
        "type": "location",
        "place": {"name": "Office", "latitude": 40.7128, "longitude": -74.006, "radius_meters": 200},
        "on": "arrive",
    }))
    .unwrap();
    action.next_run_at = None;
    let created = actions.create_action(action).await.unwrap();
    let stored = actions
        .get_action(&created.id.unwrap())
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(
        stored.trigger,
        ActionTrigger::Location {
            on: LocationTransition::Arrive,
            ..
        }
    ));
    assert_eq!(stored.next_run_at, None);

    let fence = fences(&stored).remove(0).id;
    let repo = PgLocationRepo::new(pool.clone());
    assert!(
        repo.claim_firing(&fence, Duration::minutes(10))
            .await
            .unwrap()
    );
    assert!(
        !repo
            .claim_firing(&fence, Duration::minutes(10))
            .await
            .unwrap()
    );
    // Once the cooldown has passed, the place runs its routine again.
    assert!(repo.claim_firing(&fence, Duration::zero()).await.unwrap());

    actions.delete_action(&stored.id.unwrap()).await.unwrap();
    let firings =
        sqlx::query_scalar!("SELECT COUNT(*) AS \"count!\" FROM scheduled_action_location_firing")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(firings, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_routine_mixes_places_with_schedules(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let actions = test_repo(pool);
    let mut action = sample_action(user_owner(USER_A), "Leaving work");
    action.trigger = serde_json::from_value(json!({
        "type": "multiple",
        "triggers": [
            {"type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC"},
            {
                "type": "location",
                "place": {"name": "Office", "latitude": 40.7128, "longitude": -74.006, "radius_meters": 200},
                "on": "leave",
            },
        ],
    }))
    .unwrap();
    let created = actions.create_action(action).await.unwrap();
    let stored = actions
        .get_action(&created.id.unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.trigger.places().len(), 1);
    assert!(stored.trigger.has_schedule());
}
