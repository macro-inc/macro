use super::*;
use crate::parity::lab::RequestBody;
use crate::pubsub::label_write_sim::world;

enum Route {
    Single,
    Batch,
    Thread,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Query-stage faults use uncached test SQL"
)]
async fn fault(pool: PgPool, name: &'static str, shard: u32, route: Route, sql: &str) {
    let mut lab = start(pool, name, shard).await;
    sqlx::query(sql)
        .execute(&lab.db)
        .await
        .expect("install read fault");
    let message = lab.fixture.messages["m1a"];
    let thread = world::thread_uuid(shard, 0);
    let (method, path, body) = match route {
        Route::Single => (
            "GET",
            format!("/email/messages/{message}"),
            RequestBody::Empty,
        ),
        Route::Batch => (
            "POST",
            "/email/messages/batch".into(),
            RequestBody::Json(json!([message])),
        ),
        Route::Thread => (
            "GET",
            format!("/email/threads/{thread}/messages"),
            RequestBody::Empty,
        ),
    };
    assert_eq!(
        lab.request("database failure", method, &path, Auth::User(0), body)
            .await,
        500
    );
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn single_message_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "single_message_failure",
        30300,
        Route::Single,
        "ALTER TABLE email_messages RENAME COLUMN snippet TO parity_hidden_snippet",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn single_sender_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "single_sender_failure",
        30303,
        Route::Single,
        "ALTER TABLE email_contacts RENAME COLUMN original_photo_url TO parity_hidden_photo",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn single_recipients_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "single_recipients_failure",
        30306,
        Route::Single,
        "ALTER TABLE email_message_recipients RENAME TO parity_hidden_recipients",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn single_labels_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "single_labels_failure",
        30309,
        Route::Single,
        "ALTER VIEW email_effective_message_labels RENAME TO parity_hidden_effective_labels",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn single_links_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "single_links_failure",
        30312,
        Route::Single,
        "ALTER TABLE email_links RENAME COLUMN is_primary TO parity_hidden_primary",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_message_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "batch_message_failure",
        30315,
        Route::Batch,
        "ALTER TABLE email_messages RENAME COLUMN snippet TO parity_hidden_snippet",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_sender_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "batch_sender_failure",
        30318,
        Route::Batch,
        "ALTER TABLE email_contacts RENAME COLUMN original_photo_url TO parity_hidden_photo",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_recipients_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "batch_recipients_failure",
        30321,
        Route::Batch,
        "ALTER TABLE email_message_recipients RENAME TO parity_hidden_recipients",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_labels_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "batch_labels_failure",
        30324,
        Route::Batch,
        "ALTER VIEW email_effective_message_labels RENAME TO parity_hidden_effective_labels",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_links_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "batch_links_failure",
        30327,
        Route::Batch,
        "ALTER TABLE email_links RENAME COLUMN is_primary TO parity_hidden_primary",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn thread_message_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "thread_message_failure",
        30330,
        Route::Thread,
        "ALTER TABLE email_messages RENAME COLUMN snippet TO parity_hidden_snippet",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn thread_sender_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "thread_sender_failure",
        30333,
        Route::Thread,
        "ALTER TABLE email_contacts RENAME COLUMN original_photo_url TO parity_hidden_photo",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn thread_recipients_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "thread_recipients_failure",
        30336,
        Route::Thread,
        "ALTER TABLE email_message_recipients RENAME TO parity_hidden_recipients",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn thread_labels_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "thread_labels_failure",
        30339,
        Route::Thread,
        "ALTER VIEW email_effective_message_labels RENAME TO parity_hidden_effective_labels",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn thread_links_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "thread_links_failure",
        30342,
        Route::Thread,
        "ALTER TABLE email_links RENAME COLUMN is_primary TO parity_hidden_primary",
    )
    .await;
}
