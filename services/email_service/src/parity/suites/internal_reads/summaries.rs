use super::*;
use crate::pubsub::label_write_sim::world;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
#[expect(
    clippy::disallowed_methods,
    reason = "Summary fixtures use uncached test SQL"
)]
async fn senders_results(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "senders_results", 31200).await;
    let own = lab.fixture.messages["m1a"];
    let second = lab.fixture.messages["a2a"];
    let second_reply = lab.fixture.messages["a2b"];
    let delegated = lab.fixture.messages["b1a"];
    let user = lab.fixture.users[0].clone();
    let other_user = lab.fixture.users[1].clone();
    let path = "/internal/messages/senders";
    post(
        &mut lab,
        "only newest own inbox selected",
        path,
        Auth::Internal,
        json!({"user_id":user,"message_ids":[own,second,second_reply,delegated,MISSING]}),
        200,
    )
    .await;
    post(
        &mut lab,
        "other owner inbox",
        path,
        Auth::Internal,
        json!({"user_id":other_user,"message_ids":[delegated,own]}),
        200,
    )
    .await;
    for (name, ids) in [
        ("empty", vec![]),
        ("unknown", vec![MISSING]),
        ("duplicates", vec![second, second]),
    ] {
        post(
            &mut lab,
            name,
            path,
            Auth::Internal,
            json!({"user_id":user,"message_ids":ids}),
            200,
        )
        .await;
    }
    sqlx::query("UPDATE email_contacts SET name=NULL WHERE id=(SELECT from_contact_id FROM email_messages WHERE id=$1)")
        .bind(second_reply).execute(&lab.db).await.expect("sender name absent");
    sqlx::query("UPDATE email_messages SET from_contact_id=NULL WHERE id=$1")
        .bind(second)
        .execute(&lab.db)
        .await
        .expect("sender absent");
    post(
        &mut lab,
        "absent sender and fallback name",
        path,
        Auth::Internal,
        json!({"user_id":user,"message_ids":[second,second_reply]}),
        200,
    )
    .await;
    sqlx::query("UPDATE email_links SET created_at='2026-02-01' WHERE id=$1")
        .bind(lab.fixture.links[0])
        .execute(&lab.db)
        .await
        .expect("switch newest inbox");
    post(
        &mut lab,
        "first inbox selected when newest",
        path,
        Auth::Internal,
        json!({"user_id":user,"message_ids":[own,second,delegated]}),
        200,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
#[expect(
    clippy::disallowed_methods,
    reason = "History fixtures use uncached test SQL"
)]
async fn histories_results(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let shard = 31203;
    let mut lab = start(pool, "histories_results", shard).await;
    let own = world::thread_uuid(shard, 0);
    let second = world::thread_uuid(shard + 2, 0);
    let delegated = world::thread_uuid(shard + 1, 0);
    let user = lab.fixture.users[0].clone();
    let other_user = lab.fixture.users[1].clone();
    let body = json!({"user_id":user,"thread_ids":[own,second,delegated,MISSING]});
    let path = "/internal/threads/histories";
    post(
        &mut lab,
        "only newest own inbox selected",
        path,
        Auth::Internal,
        body.clone(),
        200,
    )
    .await;
    post(
        &mut lab,
        "other owner inbox",
        path,
        Auth::Internal,
        json!({"user_id":other_user,"thread_ids":[delegated,own]}),
        200,
    )
    .await;
    for (name, ids) in [
        ("empty", vec![]),
        ("unknown", vec![MISSING]),
        ("duplicates", vec![second, second]),
    ] {
        post(
            &mut lab,
            name,
            path,
            Auth::Internal,
            json!({"user_id":user,"thread_ids":ids}),
            200,
        )
        .await;
    }
    sqlx::query("INSERT INTO email_user_history (link_id,thread_id,created_at,updated_at) VALUES ($1,$2,'2026-01-01','2026-01-01')")
        .bind(lab.fixture.links[2]).bind(second).execute(&lab.db).await.expect("old history");
    post(
        &mut lab,
        "view before last message",
        path,
        Auth::Internal,
        body.clone(),
        200,
    )
    .await;
    sqlx::query("UPDATE email_user_history SET updated_at=(SELECT max(sent_at) FROM email_messages WHERE thread_id=$1) WHERE thread_id=$1")
        .bind(second).execute(&lab.db).await.expect("equal history");
    post(
        &mut lab,
        "view equals last message",
        path,
        Auth::Internal,
        body.clone(),
        200,
    )
    .await;
    sqlx::query("UPDATE email_user_history SET updated_at='2027-01-01' WHERE thread_id=$1")
        .bind(second)
        .execute(&lab.db)
        .await
        .expect("new history");
    post(
        &mut lab,
        "view after last message",
        path,
        Auth::Internal,
        body.clone(),
        200,
    )
    .await;
    sqlx::query("UPDATE email_messages SET from_contact_id=NULL WHERE id=$1")
        .bind(lab.fixture.messages["a2b"])
        .execute(&lab.db)
        .await
        .expect("no latest sender");
    post(
        &mut lab,
        "latest sender absent",
        path,
        Auth::Internal,
        body.clone(),
        200,
    )
    .await;
    sqlx::query("INSERT INTO email_message_labels (message_id,label_id) VALUES ($1,$2)")
        .bind(lab.fixture.messages["a2b"])
        .bind(lab.fixture.labels["A2/TRASH"])
        .execute(&lab.db)
        .await
        .expect("trashed latest");
    post(
        &mut lab,
        "trashed latest omitted",
        path,
        Auth::Internal,
        body.clone(),
        200,
    )
    .await;
    sqlx::query("DELETE FROM email_message_labels WHERE message_id=$1 AND label_id=$2")
        .bind(lab.fixture.messages["a2b"])
        .bind(lab.fixture.labels["A2/TRASH"])
        .execute(&lab.db)
        .await
        .expect("untrash");
    sqlx::query("UPDATE email_messages SET is_draft=true,sent_at=NULL,updated_at='2026-10-01'::timestamptz + CASE WHEN id=$1 THEN interval '1 day' ELSE interval '0 day' END WHERE thread_id=$2")
        .bind(lab.fixture.messages["a2b"]).bind(second).execute(&lab.db).await.expect("draft fallback");
    post(
        &mut lab,
        "all drafts use updated time",
        path,
        Auth::Internal,
        body.clone(),
        200,
    )
    .await;
    sqlx::query(
        "UPDATE email_messages SET mailbox_state='{\"provider_missing\":true}' WHERE thread_id=$1",
    )
    .bind(second)
    .execute(&lab.db)
    .await
    .expect("discarded drafts");
    post(
        &mut lab,
        "only discarded drafts omitted",
        path,
        Auth::Internal,
        body,
        200,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn senders_rejections(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "senders_rejections", 31206).await;
    summary_rejections(&mut lab, "/internal/messages/senders", "message_ids").await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn histories_rejections(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "histories_rejections", 31209).await;
    summary_rejections(&mut lab, "/internal/threads/histories", "thread_ids").await;
    lab.transcript.finish();
}

async fn summary_rejections(lab: &mut Lab, path: &str, field: &str) {
    let user = lab.fixture.users[0].clone();
    rejected_bodies(
        lab,
        path,
        Auth::Internal,
        json!({"user_id":user,field:["invalid"]}),
    )
    .await;
    post(
        lab,
        "missing ids field",
        path,
        Auth::Internal,
        json!({"user_id":user}),
        422,
    )
    .await;
    post(
        lab,
        "missing user field",
        path,
        Auth::Internal,
        json!({field:[]}),
        422,
    )
    .await;
    let no_inbox_user = lab.fixture.users[2].clone();
    post(
        lab,
        "user has no inbox",
        path,
        Auth::Internal,
        json!({"user_id":no_inbox_user,field:[]}),
        404,
    )
    .await;
    post(
        lab,
        "unknown user",
        path,
        Auth::Internal,
        json!({"user_id":"macro|unknown@example.com",field:[]}),
        404,
    )
    .await;
    post(
        lab,
        "empty user",
        path,
        Auth::Internal,
        json!({"user_id":"",field:[]}),
        500,
    )
    .await;
    internal_auth(lab, "POST", path, json!({"user_id":user,field:[]})).await;
}
