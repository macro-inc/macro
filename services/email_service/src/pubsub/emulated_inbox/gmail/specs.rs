//! What the owner sees when Gmail fails, or sends something odd, while
//! the inbox keeps up with its mailbox.

use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mail_survives_a_brief_gmail_outage(pool: PgPool) {
    let mut inbox = GmailInbox::connected(pool).await;
    let mail = inbox.receives(Mail::from("lee@example.com"));
    inbox.gmail_fails(Route::MessagesGet, FaultError::Internal, 3);

    inbox.syncs().await;

    assert!(
        inbox.shows(&mail).await.is_some(),
        "lost: {:?}",
        inbox.dead_letters()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_notification_before_the_first_backfill_is_dropped_quietly(pool: PgPool) {
    let mut inbox = GmailInbox::connected(pool).await;
    inbox.has_no_sync_cursor_yet().await;
    inbox.receives(Mail::from("lee@example.com"));

    inbox.syncs().await;

    assert!(
        inbox.dead_letters().is_empty(),
        "{:?}",
        inbox.dead_letters()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_owner_who_left_gmail_access_unticked_is_asked_to_reconnect(pool: PgPool) {
    let mut inbox = GmailInbox::connected_without_gmail_access(pool).await;
    inbox.receives(Mail::from("lee@example.com"));

    inbox.syncs().await;

    assert!(inbox.asks_owner_to_reconnect().await);
}

/// The bullet is Windows-1252, but the part claims UTF-8, as mail from some
/// older clients does.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn windows_1252_mail_mislabelled_as_utf8_reads_correctly(pool: PgPool) {
    let mut inbox = GmailInbox::connected(pool).await;
    let mail = inbox.receives(Mail::raw(
        "From: lee@example.com\r\nTo: owner@example.com\r\nSubject: List\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=\"utf-8\"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=95 first\r\n",
    ));

    inbox.syncs().await;

    let body = inbox
        .shows(&mail)
        .await
        .unwrap()
        .body_text
        .unwrap_or_default();
    assert!(body.contains("• first"), "{body:?}");
}
