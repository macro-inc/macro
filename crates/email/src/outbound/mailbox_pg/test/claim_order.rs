//! Which due folder stream a claim takes: import rounds go ahead of finished
//! folders that came due a little earlier, never of ones due much earlier.

use crate::domain::mailbox::SyncRetry;
use crate::domain::mailbox::live_pass::StreamKind;
use crate::domain::mailbox::{MailboxSyncRepository, StreamLease};
use crate::outbound::mailbox_pg::PgMailboxSync;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

/// A mailbox with one folder stream, due `due_seconds_ago`; `finished` once
/// the folder's import round is done.
async fn mailbox(db: &PgPool, address: &str, finished: bool, due_seconds_ago: f64) -> Uuid {
    let link = macro_uuid::generate_uuid_v7();
    sqlx::query!(r#"
        INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,grant_generation)
        VALUES ($1,'macro|' || $2,'outlook-owner',$2,'OUTLOOK',1)
    "#,link,address).execute(db).await.unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,initial_complete,next_run_at)
        VALUES ($1,$2,1,'mail_folder','folder',$3,now() - make_interval(secs => $4))
    "#,
        macro_uuid::generate_uuid_v7(),
        link,
        finished,
        due_seconds_ago
    )
    .execute(db)
    .await
    .unwrap();
    link
}

async fn claim(repo: &PgMailboxSync) -> StreamLease {
    repo.claim_stream(macro_uuid::generate_uuid_v7(), StreamKind::MailFolder)
        .await
        .unwrap()
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn import_rounds_go_ahead_of_finished_folders_due_shortly_before_them(db: PgPool) {
    let polled = mailbox(&db, "polled@example.com", true, 120.0).await;
    let first = mailbox(&db, "first@example.com", false, 10.0).await;
    let second = mailbox(&db, "second@example.com", false, 5.0).await;
    let repo = PgMailboxSync::new(db.clone());

    let order = [
        claim(&repo).await.mailbox.link_id,
        claim(&repo).await.mailbox.link_id,
        claim(&repo).await.mailbox.link_id,
    ];
    assert_eq!(order, [first, second, polled]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_finished_folder_due_past_the_head_start_waits_for_no_round_that_came_due_later(
    db: PgPool,
) {
    // Due six minutes ago, past the five-minute head start.
    let polled = mailbox(&db, "polled@example.com", true, 360.0).await;
    // Came due within five minutes after the poll: these still go first.
    let earlier = mailbox(&db, "earlier@example.com", false, 240.0).await;
    let early = mailbox(&db, "early@example.com", false, 120.0).await;
    // Came due more than five minutes after the poll.
    let later = mailbox(&db, "later@example.com", false, 30.0).await;
    let repo = PgMailboxSync::new(db.clone());

    // Each round read is due again at once, as a committed page leaves it,
    // so the importing mailboxes always have a round due.
    let mut before_poll = Vec::new();
    for _ in 0..10 {
        let lease = claim(&repo).await;
        if lease.mailbox.link_id == polled {
            break;
        }
        before_poll.push(lease.mailbox.link_id);
        repo.release_stream(&lease, SyncRetry::Local(0))
            .await
            .unwrap();
    }
    assert_eq!(
        before_poll,
        [earlier, early],
        "only rounds due less than five minutes after the poll go before it, once each"
    );
    assert_eq!(claim(&repo).await.mailbox.link_id, later);
}
