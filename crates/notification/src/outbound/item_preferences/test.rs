use super::*;
use crate::outbound::repository::NotificationDbOps;
use chrono::Duration;
use cowlike::CowLike;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{email}@example.com"))
        .unwrap()
        .into_owned()
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
