//! A checkpoint schedules a finished folder's next poll by whether its
//! mailbox has a working Graph subscription.

use super::{fixture, page};
use crate::domain::mailbox::claim::StreamClaim;
use crate::domain::mailbox::schedule::POLL_INTERVALS;
use crate::domain::mailbox::{MailboxSyncRepository, StreamLease};
use crate::outbound::mailbox_pg::PgMailboxSync;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

/// A subscription of `generation`, registered with Graph as `provider_id`
/// unless that is `None`, expiring `expires_in_seconds` from now, beside an
/// upkeep row with `failures` failed renewals in a row.
async fn subscribe(
    db: &PgPool,
    link: Uuid,
    generation: i64,
    provider_id: Option<&str>,
    expires_in_seconds: f64,
    failures: i32,
) {
    sqlx::query!(
        "INSERT INTO email_mailbox_watch_work (link_id, failures) VALUES ($1, $2)",
        link,
        failures
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_provider_subscriptions (id, link_id, generation, provider_id, client_state_hash, expires_at)
        VALUES ($1, $2, $3, $4, '\x00', now() + make_interval(secs => $5))
    "#,
        macro_uuid::generate_uuid_v7(),
        link,
        generation,
        provider_id,
        expires_in_seconds
    )
    .execute(db)
    .await
    .unwrap();
}

async fn claim(repo: &PgMailboxSync) -> StreamLease {
    repo.claim_stream(macro_uuid::generate_uuid_v7(), StreamClaim::LongestDue)
        .await
        .unwrap()
        .into_lease()
        .unwrap()
}

/// Seconds from the checkpoint until the stream is due again; the commit
/// sets both from the same `now()`.
async fn poll_interval_seconds(db: &PgPool, stream: Uuid) -> f64 {
    sqlx::query_scalar!(
        r#"SELECT EXTRACT(EPOCH FROM next_run_at - last_completed_at)::float8 AS "seconds!" FROM email_sync_streams WHERE id = $1"#,
        stream
    )
    .fetch_one(db)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_mailbox_with_a_working_subscription_is_polled_every_ten_minutes(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    subscribe(&db, link, 1, Some("graph-subscription"), 3.0 * 86_400.0, 0).await;
    let lease = claim(&repo).await;

    let committed = repo
        .commit_page(&lease, &page(), POLL_INTERVALS)
        .await
        .unwrap();

    assert_eq!(committed.next_poll_seconds, Some(600));
    assert_eq!(poll_interval_seconds(&db, lease.id).await, 600.0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_mailbox_without_a_working_subscription_is_polled_every_two_minutes(db: PgPool) {
    // Each mailbox lacks one part of a working subscription.
    let cases: [(&str, i64, Option<&str>, f64, i32); 5] = [
        ("not registered with Graph", 1, None, 86_400.0, 0),
        ("expired", 1, Some("expired"), -60.0, 0),
        ("of an older generation", 0, Some("older"), 86_400.0, 0),
        ("whose last renewal failed", 1, Some("failing"), 86_400.0, 2),
        ("with no subscription", 1, None, 0.0, 0),
    ];
    let repo = PgMailboxSync::new(db.clone());
    for (index, (case, generation, provider_id, expires_in, failures)) in
        cases.into_iter().enumerate()
    {
        let link = macro_uuid::generate_uuid_v7();
        let address = format!("unsubscribed-{index}@example.com");
        sqlx::query!(r#"
            INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,grant_generation)
            VALUES ($1,'macro|' || $2,'outlook-owner',$2,'OUTLOOK',1)
        "#,link,address).execute(&db).await.unwrap();
        sqlx::query!(
            "INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id) VALUES ($1,$2,1,'mail_folder','folder')",
            macro_uuid::generate_uuid_v7(),
            link
        )
        .execute(&db)
        .await
        .unwrap();
        if case != "with no subscription" {
            subscribe(&db, link, generation, provider_id, expires_in, failures).await;
        }
        let lease = claim(&repo).await;
        assert_eq!(lease.mailbox.link_id, link);

        let committed = repo
            .commit_page(&lease, &page(), POLL_INTERVALS)
            .await
            .unwrap();

        assert_eq!(
            committed.next_poll_seconds,
            Some(120),
            "a subscription {case}"
        );
        assert_eq!(
            poll_interval_seconds(&db, lease.id).await,
            120.0,
            "a subscription {case}"
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_notification_during_the_read_leaves_a_subscribed_folder_due(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    subscribe(&db, link, 1, Some("graph-subscription"), 3.0 * 86_400.0, 0).await;
    let lease = claim(&repo).await;
    sqlx::query!(
        "UPDATE email_sync_streams SET notified_at = clock_timestamp() WHERE id = $1",
        lease.id
    )
    .execute(&db)
    .await
    .unwrap();

    let committed = repo
        .commit_page(&lease, &page(), POLL_INTERVALS)
        .await
        .unwrap();

    assert_eq!(committed.next_poll_seconds, None);
    assert_eq!(poll_interval_seconds(&db, lease.id).await, 0.0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_claim_reports_when_its_stream_came_due(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let due_at = sqlx::query_scalar!(
        "UPDATE email_sync_streams SET next_run_at = now() - interval '7 minutes' WHERE link_id = $1 RETURNING next_run_at",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();

    let lease = claim(&repo).await;

    assert_eq!(lease.due_at, due_at);
}
