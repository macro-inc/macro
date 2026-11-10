use super::*;
use crate::pubsub::label_write_sim::world;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn thread_results(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let shard = 31100;
    let mut lab = start(pool, "thread_results", shard).await;
    read_fixture::pages(&mut lab, shard).await;
    for (name, thread) in [
        ("own", world::thread_uuid(shard, 0)),
        ("second owned", world::thread_uuid(shard + 2, 0)),
        ("other owner", world::thread_uuid(shard + 1, 0)),
        ("unknown returns empty", MISSING),
    ] {
        get(
            &mut lab,
            name,
            &format!("/internal/threads/{thread}/messages"),
            Auth::Internal,
            200,
        )
        .await;
    }
    let path = format!(
        "/internal/threads/{}/messages",
        world::thread_uuid(shard, 0)
    );
    internal_auth(&mut lab, "GET", &path, json!(null)).await;
    get(
        &mut lab,
        "malformed path",
        "/internal/threads/invalid/messages",
        Auth::Internal,
        400,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn thread_pagination(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let shard = 31103;
    let mut lab = start(pool, "thread_pagination", shard).await;
    let thread = read_fixture::pages(&mut lab, shard).await;
    for (step, query, status) in [
        ("defaults", "", 200),
        (
            "explicit defaults",
            "?message_offset=0&message_limit=5",
            200,
        ),
        ("one newest", "?message_limit=1", 200),
        ("offset only", "?message_offset=1", 200),
        ("middle page", "?message_offset=2&message_limit=2", 200),
        ("maximum includes null date", "?message_limit=100", 200),
        ("last row", "?message_offset=8&message_limit=1", 200),
        ("past end", "?message_offset=100", 200),
        ("largest offset", "?message_offset=9223372036854775807", 200),
        ("negative offset falls back", "?message_offset=-1", 200),
        ("zero limit falls back", "?message_limit=0", 200),
        ("negative limit falls back", "?message_limit=-1", 200),
        ("above maximum falls back", "?message_limit=101", 200),
        (
            "largest limit falls back",
            "?message_limit=9223372036854775807",
            200,
        ),
        ("both fall back", "?message_offset=-1&message_limit=0", 200),
        ("invalid limit", "?message_limit=no", 400),
        ("invalid offset", "?message_offset=no", 400),
        ("overflow", "?message_limit=9223372036854775808", 400),
        ("empty parameter", "?message_limit=", 400),
        (
            "duplicate parameter",
            "?message_limit=1&message_limit=2",
            400,
        ),
        (
            "public pagination and cursor ignored",
            "?offset=1&limit=1&cursor=bad&since=bad&order=asc",
            200,
        ),
    ] {
        get(
            &mut lab,
            step,
            &format!("/internal/threads/{thread}/messages{query}"),
            Auth::Internal,
            status,
        )
        .await;
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
#[expect(
    clippy::disallowed_methods,
    reason = "The invalid-owner fixture uses uncached test SQL"
)]
async fn thread_owner(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let shard = 31106;
    let mut lab = start(pool, "thread_owner", shard).await;
    for (name, thread) in [
        ("own", world::thread_uuid(shard, 0)),
        ("second owned", world::thread_uuid(shard + 2, 0)),
        ("other owner", world::thread_uuid(shard + 1, 0)),
    ] {
        get(
            &mut lab,
            name,
            &format!("/internal/threads/{thread}/owner"),
            Auth::Internal,
            200,
        )
        .await;
    }
    let path = format!("/internal/threads/{}/owner", world::thread_uuid(shard, 0));
    internal_auth(&mut lab, "GET", &path, json!(null)).await;
    get(
        &mut lab,
        "unknown thread",
        &format!("/internal/threads/{MISSING}/owner"),
        Auth::Internal,
        404,
    )
    .await;
    get(
        &mut lab,
        "malformed thread",
        "/internal/threads/invalid/owner",
        Auth::Internal,
        400,
    )
    .await;
    sqlx::query("UPDATE email_links SET macro_id='invalid-user-id' WHERE id=$1")
        .bind(lab.fixture.links[0])
        .execute(&lab.db)
        .await
        .expect("invalid owner");
    get(&mut lab, "stored invalid owner", &path, Auth::Internal, 400).await;
    lab.transcript.finish();
}
