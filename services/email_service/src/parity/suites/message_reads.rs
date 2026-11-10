//! Current public message read contracts, before moving their persistence boundary.
use super::read_fixture::{self, MISSING, get, post, rejected_bodies};
use crate::parity::lab::{Auth, Lab};
use serde_json::json;
use sqlx::PgPool;

mod faults;
mod threads;

async fn start(pool: PgPool, name: &'static str, shard: u32) -> Lab {
    read_fixture::start(pool, "message_reads", name, shard).await
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn message_success(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "message_success", 30000).await;
    for (name, auth) in [
        ("m1a", Auth::User(0)),
        ("m1b", Auth::User(0)),
        ("m3a", Auth::User(0)),
        ("draft", Auth::User(0)),
        ("a2a", Auth::User(0)),
        ("b1a", Auth::User(0)),
        ("b1b", Auth::User(1)),
        ("m1a", Auth::Internal),
    ] {
        let path = format!("/email/messages/{}", lab.fixture.messages[name]);
        get(&mut lab, name, &path, auth, 200).await;
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn message_rejections(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "message_rejections", 30003).await;
    get(
        &mut lab,
        "unknown id",
        &format!("/email/messages/{MISSING}"),
        Auth::User(0),
        404,
    )
    .await;
    get(
        &mut lab,
        "malformed id",
        "/email/messages/not-a-uuid",
        Auth::User(0),
        400,
    )
    .await;
    let path = format!("/email/messages/{}", lab.fixture.messages["m1a"]);
    for (name, auth, status) in [
        ("other inbox owner", Auth::User(1), 401),
        ("no inboxes", Auth::User(2), 401),
        ("invalid bearer", Auth::InvalidBearer, 401),
        ("internal without user", Auth::InternalKeyOnly, 401),
        ("wrong internal key", Auth::WrongInternalKey, 401),
        ("missing credentials", Auth::MissingCredentials, 401),
    ] {
        get(&mut lab, name, &path, auth, status).await;
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_success(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "batch_success", 30006).await;
    let ids = ["m1a", "m1b", "draft", "a2a", "b1a", "m3a"].map(|name| lab.fixture.messages[name]);
    post(
        &mut lab,
        "all accessible inboxes",
        "/email/messages/batch",
        Auth::User(0),
        json!(ids),
        200,
    )
    .await;
    post(
        &mut lab,
        "internal acting user",
        "/email/messages/batch",
        Auth::Internal,
        json!(ids),
        200,
    )
    .await;
    post(
        &mut lab,
        "second inbox alone",
        "/email/messages/batch",
        Auth::User(0),
        json!([ids[3]]),
        200,
    )
    .await;
    post(
        &mut lab,
        "delegated inbox alone",
        "/email/messages/batch",
        Auth::User(0),
        json!([ids[4]]),
        200,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_partial(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "batch_partial", 30009).await;
    let own = lab.fixture.messages["b1a"];
    let foreign = lab.fixture.messages["m1a"];
    for (step, ids, status) in [
        (
            "accessible foreign unknown",
            vec![foreign, own, MISSING],
            200,
        ),
        ("foreign and unknown only", vec![foreign, MISSING], 401),
        ("unknown only", vec![MISSING], 404),
        ("empty", vec![], 404),
        ("duplicate accessible", vec![own, own], 200),
        ("duplicate missing", vec![own, MISSING, MISSING], 200),
        ("foreign only", vec![foreign], 401),
    ] {
        post(
            &mut lab,
            step,
            "/email/messages/batch",
            Auth::User(1),
            json!(ids),
            status,
        )
        .await;
    }
    post(
        &mut lab,
        "no inboxes",
        "/email/messages/batch",
        Auth::User(2),
        json!([foreign]),
        401,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_rejections(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "batch_rejections", 30012).await;
    rejected_bodies(
        &mut lab,
        "/email/messages/batch",
        Auth::User(0),
        json!(["invalid"]),
    )
    .await;
    let body = json!([lab.fixture.messages["m1a"]]);
    for (name, auth, status) in [
        ("invalid bearer", Auth::InvalidBearer, 401),
        ("missing credentials", Auth::MissingCredentials, 401),
        ("internal without user", Auth::InternalKeyOnly, 401),
        ("wrong internal key", Auth::WrongInternalKey, 401),
    ] {
        post(
            &mut lab,
            name,
            "/email/messages/batch",
            auth,
            body.clone(),
            status,
        )
        .await;
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
#[expect(
    clippy::disallowed_methods,
    reason = "Revoked-delegation fixture uses uncached test SQL"
)]
async fn internal_caller_remains_scoped(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "internal_caller_remains_scoped", 30015).await;
    sqlx::query("DELETE FROM macro_user_links")
        .execute(&lab.db)
        .await
        .expect("remove delegation");
    let foreign = lab.fixture.messages["b1a"];
    let own = lab.fixture.messages["m1a"];
    get(
        &mut lab,
        "internal cannot read unshared inbox",
        &format!("/email/messages/{foreign}"),
        Auth::Internal,
        401,
    )
    .await;
    post(
        &mut lab,
        "internal partial batch",
        "/email/messages/batch",
        Auth::Internal,
        json!([foreign, own]),
        200,
    )
    .await;
    lab.transcript.finish();
}
