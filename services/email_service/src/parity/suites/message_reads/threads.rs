use super::*;
use crate::pubsub::label_write_sim::world;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn thread_success(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let shard = 30100;
    let mut lab = start(pool, "thread_success", shard).await;
    read_fixture::pages(&mut lab, shard).await;
    for (name, thread, auth) in [
        ("own thread", world::thread_uuid(shard, 0), Auth::User(0)),
        (
            "second own inbox",
            world::thread_uuid(shard + 2, 0),
            Auth::User(0),
        ),
        (
            "delegated inbox",
            world::thread_uuid(shard + 1, 0),
            Auth::User(0),
        ),
        (
            "internal acting user",
            world::thread_uuid(shard, 0),
            Auth::Internal,
        ),
    ] {
        get(
            &mut lab,
            name,
            &format!("/email/threads/{thread}/messages"),
            auth,
            200,
        )
        .await;
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn thread_pagination(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let shard = 30103;
    let mut lab = start(pool, "thread_pagination", shard).await;
    let thread = read_fixture::pages(&mut lab, shard).await;
    for (step, query, status) in [
        ("defaults", "", 200),
        ("explicit default bounds", "?offset=0&limit=5", 200),
        ("one newest", "?limit=1", 200),
        ("offset without limit", "?offset=1", 200),
        ("middle page", "?offset=2&limit=2", 200),
        ("maximum includes null date last", "?limit=100", 200),
        ("last row", "?offset=8&limit=1", 200),
        ("offset past end", "?offset=100", 401),
        ("largest offset", "?offset=9223372036854775807", 401),
        ("negative offset", "?offset=-1", 400),
        ("zero limit", "?limit=0", 400),
        ("negative limit", "?limit=-1", 400),
        ("above maximum", "?limit=101", 400),
        ("largest limit", "?limit=9223372036854775807", 400),
        ("both invalid offset first", "?offset=-1&limit=0", 400),
        ("invalid integer", "?limit=no", 400),
        ("invalid offset", "?offset=no", 400),
        ("overflow", "?limit=9223372036854775808", 400),
        ("empty parameter", "?limit=", 400),
        ("duplicate parameter", "?limit=1&limit=2", 400),
        (
            "unimplemented since cursor ordering ignored",
            "?since=bad&cursor=bad&order=asc",
            200,
        ),
    ] {
        get(
            &mut lab,
            step,
            &format!("/email/threads/{thread}/messages{query}"),
            Auth::User(0),
            status,
        )
        .await;
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn thread_rejections(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let shard = 30106;
    let mut lab = start(pool, "thread_rejections", shard).await;
    get(
        &mut lab,
        "unknown thread",
        &format!("/email/threads/{MISSING}/messages"),
        Auth::User(0),
        401,
    )
    .await;
    get(
        &mut lab,
        "malformed thread",
        "/email/threads/invalid/messages",
        Auth::User(0),
        400,
    )
    .await;
    let path = format!("/email/threads/{}/messages", world::thread_uuid(shard, 0));
    for (name, auth, status) in [
        ("other owner", Auth::User(1), 401),
        ("no inboxes", Auth::User(2), 401),
        ("invalid bearer", Auth::InvalidBearer, 401),
        ("missing credentials", Auth::MissingCredentials, 401),
        ("internal without user", Auth::InternalKeyOnly, 401),
        ("wrong internal key", Auth::WrongInternalKey, 401),
    ] {
        get(&mut lab, name, &path, auth, status).await;
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
#[expect(
    clippy::disallowed_methods,
    reason = "Cross-inbox filter fixture uses uncached test SQL"
)]
async fn thread_filters_each_message(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let shard = 30109;
    let mut lab = start(pool, "thread_filters_each_message", shard).await;
    sqlx::query("UPDATE email_messages SET link_id=$2 WHERE id=$1")
        .bind(lab.fixture.messages["m1a"])
        .bind(lab.fixture.links[1])
        .execute(&lab.db)
        .await
        .expect("mixed-link thread");
    let path = format!(
        "/email/threads/{}/messages?limit=100",
        world::thread_uuid(shard, 0)
    );
    get(
        &mut lab,
        "only the accessible message",
        &path,
        Auth::User(1),
        200,
    )
    .await;
    sqlx::query("DELETE FROM email_messages WHERE thread_id=$1")
        .bind(world::thread_uuid(shard, 1))
        .execute(&lab.db)
        .await
        .expect("empty thread");
    let path = format!("/email/threads/{}/messages", world::thread_uuid(shard, 1));
    get(&mut lab, "existing empty thread", &path, Auth::User(0), 401).await;
    lab.transcript.finish();
}
