use super::*;
use crate::repository::NotificationDbOps;
use chrono::Duration;
use cowlike::CowLike;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{email}@example.com"))
        .unwrap()
        .into_owned()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("legacy_item_preferences"))
)]
async fn lists_supported_preferences_despite_unknown_legacy_types(pool: PgPool) {
    let repo = PgItemNotificationPreferenceRepository(pool);
    let listed = repo.list(user("alice")).await.unwrap();
    let preferences: Vec<_> = listed
        .iter()
        .map(|item| (item.entity.entity_id.as_ref(), item.entity.entity_type))
        .collect();
    assert_eq!(
        preferences,
        vec![
            ("document-snoozed", EntityType::Document),
            ("channel-muted", EntityType::Channel),
            ("email-alias", EntityType::EmailThread),
            ("foreign-alias", EntityType::ForeignEntity),
            ("thread-alias", EntityType::EmailThread),
        ]
    );
    assert!(listed[0].snoozed_until.is_some());
    assert!(listed[1..].iter().all(|item| item.snoozed_until.is_none()));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn snooze_expiry_replacement_and_owner_isolation(pool: PgPool) {
    let repo = PgItemNotificationPreferenceRepository(pool.clone());
    let entity = || EntityType::Document.with_entity_str("document-one");
    let future = Utc::now() + Duration::hours(1);
    repo.set(user("alice"), entity(), Some(future))
        .await
        .unwrap();
    repo.set(user("bob"), entity(), None).await.unwrap();

    let listed = repo.list(user("alice")).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        listed[0].snoozed_until.unwrap().timestamp(),
        future.timestamp()
    );
    let recipients = [user("alice"), user("bob"), user("carol")];
    let muted = pool
        .get_unsubscribed_users("document-one", &recipients)
        .await
        .unwrap();
    assert_eq!(muted.len(), 2);
    assert!(!muted.contains(&user("carol")));

    // Simulate the clock moving past expiry without requiring a running client or cleanup job.
    repo.set(
        user("alice"),
        entity(),
        Some(Utc::now() - Duration::seconds(1)),
    )
    .await
    .unwrap();
    assert!(repo.list(user("alice")).await.unwrap().is_empty());
    let muted = pool
        .get_unsubscribed_users("document-one", &recipients)
        .await
        .unwrap();
    assert!(!muted.contains(&user("alice")));
    assert!(muted.contains(&user("bob")));

    repo.set(user("alice"), entity(), None).await.unwrap();
    assert!(
        repo.list(user("alice")).await.unwrap()[0]
            .snoozed_until
            .is_none()
    );
    repo.set(user("alice"), entity(), Some(future))
        .await
        .unwrap();
    assert!(
        repo.list(user("alice")).await.unwrap()[0]
            .snoozed_until
            .is_some()
    );
    repo.remove(user("alice"), entity()).await.unwrap();
    assert!(repo.list(user("alice")).await.unwrap().is_empty());
    assert_eq!(repo.list(user("bob")).await.unwrap().len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bulk_updates_and_removals_are_atomic_and_owner_scoped(pool: PgPool) {
    let repo = PgItemNotificationPreferenceRepository(pool);
    let first = EntityType::Channel.with_entity_string("first".to_owned());
    let second = EntityType::Document.with_entity_string("second".to_owned());
    let future = Utc::now() + Duration::hours(1);
    repo.set_bulk(
        user("alice"),
        &[first.clone(), second.clone()],
        Some(future),
    )
    .await
    .unwrap();
    repo.set_bulk(user("bob"), &[first.clone()], None)
        .await
        .unwrap();
    assert_eq!(repo.list(user("alice")).await.unwrap().len(), 2);
    assert_eq!(repo.list(user("bob")).await.unwrap().len(), 1);

    // A database constraint fails on the second row, rolling back the first update.
    sqlx::query!("ALTER TABLE user_notification_item_unsubscribe ADD CONSTRAINT reject_bulk_item CHECK (item_id <> 'reject')")
        .execute(&repo.0).await.unwrap();
    let invalid = EntityType::Document.with_entity_string("reject".to_owned());
    assert!(
        repo.set_bulk(user("alice"), &[first.clone(), invalid], None)
            .await
            .is_err()
    );
    assert_eq!(
        repo.list(user("alice"))
            .await
            .unwrap()
            .iter()
            .find(|item| item.entity.entity_id.as_ref() == "first")
            .unwrap()
            .snoozed_until
            .map(|deadline| deadline.timestamp_micros()),
        Some(future.timestamp_micros())
    );

    repo.set_bulk(user("alice"), &[first.clone(), second.clone()], None)
        .await
        .unwrap();
    assert!(
        repo.list(user("alice"))
            .await
            .unwrap()
            .iter()
            .all(|item| item.snoozed_until.is_none())
    );
    repo.remove_bulk(user("alice"), &[first, second])
        .await
        .unwrap();
    assert!(repo.list(user("alice")).await.unwrap().is_empty());
    assert_eq!(repo.list(user("bob")).await.unwrap().len(), 1);
}
