//! Current internal read contracts, including their intentionally different scopes.
use super::read_fixture::{self, MISSING, get, internal_auth, post, rejected_bodies};
use crate::parity::lab::{Auth, Lab};
use serde_json::json;
use sqlx::PgPool;

mod faults;
mod summaries;
mod threads;

async fn start(pool: PgPool, name: &'static str, shard: u32) -> Lab {
    read_fixture::start(pool, "internal_reads", name, shard).await
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn message_success(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "message_success", 31000).await;
    for name in ["m1a", "m1b", "draft", "a2a", "b1a", "m3a"] {
        let path = format!("/internal/messages/{}", lab.fixture.messages[name]);
        get(&mut lab, name, &path, Auth::Internal, 200).await;
    }
    get(
        &mut lab,
        "unknown id",
        &format!("/internal/messages/{MISSING}"),
        Auth::Internal,
        404,
    )
    .await;
    get(
        &mut lab,
        "malformed id",
        "/internal/messages/invalid",
        Auth::Internal,
        400,
    )
    .await;
    let path = format!("/internal/messages/{}", lab.fixture.messages["m1a"]);
    internal_auth(&mut lab, "GET", &path, json!(null)).await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_results(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "batch_results", 31003).await;
    let first = lab.fixture.messages["m1a"];
    let ids = ["m1a", "m1b", "draft", "a2a", "b1a", "m3a"].map(|name| lab.fixture.messages[name]);
    post(
        &mut lab,
        "all inboxes",
        "/internal/messages/batch",
        Auth::Internal,
        json!(ids),
        200,
    )
    .await;
    for (step, ids, status) in [
        ("some unknown", vec![MISSING, first], 200),
        ("duplicate found", vec![first, first], 200),
        ("duplicate missing", vec![MISSING, first, MISSING], 200),
        ("all unknown", vec![MISSING], 404),
        ("empty succeeds", vec![], 200),
    ] {
        post(
            &mut lab,
            step,
            "/internal/messages/batch",
            Auth::Internal,
            json!(ids),
            status,
        )
        .await;
    }
    internal_auth(&mut lab, "POST", "/internal/messages/batch", json!([first])).await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_rejections(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "batch_rejections", 31006).await;
    rejected_bodies(
        &mut lab,
        "/internal/messages/batch",
        Auth::Internal,
        json!(["invalid"]),
    )
    .await;
    lab.transcript.finish();
}
