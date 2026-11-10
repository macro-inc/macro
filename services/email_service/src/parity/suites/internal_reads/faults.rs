use super::*;
use crate::parity::lab::RequestBody;
use crate::pubsub::label_write_sim::world;

enum Route {
    Single,
    Batch,
    Thread,
    Owner,
    Senders,
    Histories,
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
    let user = lab.fixture.users[0].clone();
    let (method, path, body) = match route {
        Route::Single => (
            "GET",
            format!("/internal/messages/{message}"),
            RequestBody::Empty,
        ),
        Route::Batch => (
            "POST",
            "/internal/messages/batch".into(),
            RequestBody::Json(json!([message])),
        ),
        Route::Thread => (
            "GET",
            format!("/internal/threads/{thread}/messages"),
            RequestBody::Empty,
        ),
        Route::Owner => (
            "GET",
            format!("/internal/threads/{thread}/owner"),
            RequestBody::Empty,
        ),
        Route::Senders => (
            "POST",
            "/internal/messages/senders".into(),
            RequestBody::Json(json!({"user_id":user,"message_ids":[message]})),
        ),
        Route::Histories => (
            "POST",
            "/internal/threads/histories".into(),
            RequestBody::Json(json!({"user_id":user,"thread_ids":[thread]})),
        ),
    };
    assert_eq!(
        lab.request("database failure", method, &path, Auth::Internal, body)
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
        31300,
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
        31303,
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
        31306,
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
        31309,
        Route::Single,
        "ALTER VIEW email_effective_message_labels RENAME TO parity_hidden_effective_labels",
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
        31312,
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
        31315,
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
        31318,
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
        31321,
        Route::Batch,
        "ALTER VIEW email_effective_message_labels RENAME TO parity_hidden_effective_labels",
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
        31324,
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
        31327,
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
        31330,
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
        31333,
        Route::Thread,
        "ALTER VIEW email_effective_message_labels RENAME TO parity_hidden_effective_labels",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn owner_query_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "owner_query_failure",
        31336,
        Route::Owner,
        "ALTER TABLE email_threads RENAME TO parity_hidden_threads",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn senders_links_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "senders_links_failure",
        31339,
        Route::Senders,
        "ALTER TABLE email_links RENAME COLUMN is_primary TO parity_hidden_primary",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn senders_query_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "senders_query_failure",
        31342,
        Route::Senders,
        "ALTER TABLE email_contacts RENAME TO parity_hidden_summary",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn histories_links_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "histories_links_failure",
        31345,
        Route::Histories,
        "ALTER TABLE email_links RENAME COLUMN is_primary TO parity_hidden_primary",
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn histories_query_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "histories_query_failure",
        31348,
        Route::Histories,
        "ALTER TABLE email_user_history RENAME TO parity_hidden_summary",
    )
    .await;
}
