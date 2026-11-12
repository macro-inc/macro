//! How an Outlook inbox keeps up with its mailbox.

use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn new_mail_shows_up(pool: PgPool) {
    let inbox = OutlookInbox::connected(pool).await;
    let mail = inbox.receives("lee@example.com", "Q3 plan");

    inbox.syncs().await;

    assert!(inbox.shows(&mail).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mail_survives_a_brief_graph_outage(pool: PgPool) {
    let inbox = OutlookInbox::connected(pool).await;
    let mail = inbox.receives("lee@example.com", "Hello");
    inbox.graph_fails(Route::MessagesGet, FaultError::Internal, 3);

    inbox.syncs().await;
    for _ in 0..3 {
        inbox.syncs_after_backoff().await;
    }

    assert!(inbox.shows(&mail).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mail_keeps_arriving_after_graph_forgets_the_sync_state(pool: PgPool) {
    let inbox = OutlookInbox::connected(pool).await;
    let first = inbox.receives("lee@example.com", "First");
    inbox.syncs().await;
    inbox.graph_forgets_the_sync_state();
    let second = inbox.receives("lee@example.com", "Second");

    inbox.syncs().await;
    inbox.syncs().await;

    assert!(inbox.shows(&first).await);
    assert!(inbox.shows(&second).await);
}
