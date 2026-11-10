use super::*;

enum Scenario {
    Success,
    Empty,
    Auth,
    FirstQueueFailure,
    LaterQueueFailure,
    AllQueueFailures,
    DatabaseFailure,
    InvalidPaths,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local ordered inbox and query-failure fixtures"
)]
async fn run(pool: PgPool, name: &'static str, shard: u32, scenario: Scenario) {
    let (mut lab, _redis) = start(pool, name, shard).await;
    for (i, link) in lab.fixture.links.iter().enumerate() {
        sqlx::query("UPDATE email_links SET created_at='2026-01-01'::timestamptz + $2 * interval '1 day' WHERE id=$1")
            .bind(link).bind(i as i32).execute(&lab.db).await.expect("distinct inbox order");
    }
    let path = format!("/internal/delete_user/{}", lab.fixture.fusion[0]);
    match scenario {
        Scenario::Success => {
            for step in ["delete owned inboxes", "redelivery retains same inboxes"] {
                assert_eq!(
                    lab.request(
                        step,
                        "DELETE",
                        &path,
                        Auth::InternalKeyOnly,
                        RequestBody::Empty
                    )
                    .await,
                    204
                );
            }
            let b = format!("/internal/delete_user/{}", lab.fixture.fusion[1]);
            assert_eq!(
                lab.request(
                    "only the selected identity",
                    "DELETE",
                    &b,
                    Auth::Internal,
                    RequestBody::Empty
                )
                .await,
                204
            );
        }
        Scenario::Empty => {
            for id in ["missing", "not-a-uuid", "macro%7Cparity-a%40example.com"] {
                assert_eq!(
                    lab.request(
                        "identity with no inboxes",
                        "DELETE",
                        &format!("/internal/delete_user/{id}"),
                        Auth::InternalKeyOnly,
                        RequestBody::Empty
                    )
                    .await,
                    204
                );
            }
        }
        Scenario::Auth => {
            for (auth, status) in [
                (Auth::User(0), 403),
                (Auth::User(1), 403),
                (Auth::WrongInternalKey, 401),
                (Auth::MissingInternalKey, 401),
                (Auth::InvalidBearer, 401),
            ] {
                assert_eq!(
                    lab.request(
                        "internal authorization required",
                        "DELETE",
                        &path,
                        auth,
                        RequestBody::Empty
                    )
                    .await,
                    status
                );
            }
        }
        Scenario::FirstQueueFailure | Scenario::LaterQueueFailure | Scenario::AllQueueFailures => {
            match scenario {
                Scenario::FirstQueueFailure => lab.sqs.fail_nth_send(1),
                Scenario::LaterQueueFailure => lab.sqs.fail_nth_send(2),
                _ => lab.sqs.set_outage(true),
            }
            assert_eq!(
                lab.request(
                    "queue failures do not fail deletion",
                    "DELETE",
                    &path,
                    Auth::InternalKeyOnly,
                    RequestBody::Empty
                )
                .await,
                204
            );
        }
        Scenario::DatabaseFailure => {
            sqlx::query("ALTER TABLE email_links RENAME TO parity_hidden_links")
                .execute(&lab.db)
                .await
                .expect("query failure");
            assert_eq!(
                lab.request(
                    "link lookup fails",
                    "DELETE",
                    &path,
                    Auth::InternalKeyOnly,
                    RequestBody::Empty
                )
                .await,
                500
            );
        }
        Scenario::InvalidPaths => {
            assert_eq!(
                lab.request(
                    "missing path identity",
                    "DELETE",
                    "/internal/delete_user/",
                    Auth::InternalKeyOnly,
                    RequestBody::Empty
                )
                .await,
                404
            );
            assert_eq!(
                lab.request(
                    "invalid UTF-8 path identity",
                    "DELETE",
                    "/internal/delete_user/%FF",
                    Auth::InternalKeyOnly,
                    RequestBody::Empty
                )
                .await,
                400
            );
        }
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn delete_success(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "delete_success", 51200, Scenario::Success).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn delete_empty(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "delete_empty", 51203, Scenario::Empty).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn delete_auth(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "delete_auth", 51206, Scenario::Auth).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn delete_first_queue_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "delete_first_queue_failure",
        51209,
        Scenario::FirstQueueFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn delete_later_queue_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "delete_later_queue_failure",
        51212,
        Scenario::LaterQueueFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn delete_all_queue_failures(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "delete_all_queue_failures",
        51215,
        Scenario::AllQueueFailures,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn delete_database_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "delete_database_failure",
        51218,
        Scenario::DatabaseFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn delete_invalid_paths(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "delete_invalid_paths", 51221, Scenario::InvalidPaths).await;
}
