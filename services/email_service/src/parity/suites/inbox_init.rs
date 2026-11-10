//! Initialization transcripts keep the legacy handler and its partial writes intact.

use super::redis_database::RedisDatabase;
use crate::parity::lab::{Auth, Lab, LabOptions, RequestBody};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

mod access;
mod boundaries;
mod deep_faults;
mod faults;
mod outlook;
mod provider;
mod success;
mod watch;

const ATTEMPT: Uuid = Uuid::from_u128(0x6a000000000000000000000000000001);
const MISSING: Uuid = Uuid::from_u128(0x6a000000000000000000000000000002);
const GMAIL_SCOPE: &str = "https://www.googleapis.com/auth/gmail.modify";
const CALENDAR_SCOPE: &str = calendar_events::domain::models::GOOGLE_CALENDAR_EVENTS_SCOPE;
const CALENDAR_LIST_SCOPE: &str = calendar_events::domain::models::GOOGLE_CALENDAR_LIST_SCOPE;
const WATCH: &str = "/gmail/v1/users/me/watch";
// Keep provider cooldowns alive through transcript capture on a loaded runner.
const RETRY_AFTER_SECONDS: &str = "60";

async fn start(pool: PgPool, name: &'static str, shard: u32) -> (Lab, RedisDatabase) {
    start_rollout(pool, name, shard, false).await
}

async fn start_rollout(
    pool: PgPool,
    name: &'static str,
    shard: u32,
    outlook_enabled: bool,
) -> (Lab, RedisDatabase) {
    start_in_redis(
        pool,
        name,
        shard,
        outlook_enabled,
        RedisDatabase::start().await,
    )
    .await
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local identities and inbox selection"
)]
async fn start_in_redis(
    pool: PgPool,
    name: &'static str,
    shard: u32,
    outlook_enabled: bool,
    redis: RedisDatabase,
) -> (Lab, RedisDatabase) {
    let mut lab = Lab::start_configured(
        pool,
        LabOptions {
            suite: "inbox_init",
            name,
            shard,
            gmail_label_write_batches: false,
        },
        redis.uri.clone(),
        outlook_enabled,
    )
    .await;
    lab.record_redis_scope("");
    lab.transcript.normalizer.replace(&redis.uri, "<redis>");
    if let Some(user) = redis.fault_user() {
        lab.transcript
            .normalizer
            .replace(user, "<redis-fault-user>");
    }
    lab.transcript.normalizer.sort_response_keys = true;
    lab.transcript.normalizer.normalize_gmail_redis_clock = true;
    lab.transcript.normalizer.normalize_embedded_uuids = true;
    lab.transcript.normalizer.symbol(ATTEMPT, "<attempt>");
    lab.transcript.normalizer.symbol(MISSING, "<missing>");
    for i in 0..3 {
        let id: Uuid = sqlx::query_scalar("SELECT macro_user_id FROM \"User\" WHERE id=$1")
            .bind(&lab.fixture.users[i])
            .fetch_one(&lab.db)
            .await
            .expect("fixture identity");
        sqlx::query("UPDATE email_links SET fusionauth_user_id=$1 WHERE fusionauth_user_id=$2")
            .bind(id.to_string())
            .bind(&lab.fixture.fusion[i])
            .execute(&lab.db)
            .await
            .expect("valid fusion id");
        lab.fixture.fusion[i] = id.to_string();
        lab.transcript
            .normalizer
            .symbol(id, format!("<fusion:{}>", ['A', 'B', 'C'][i]));
    }
    for (i, link) in lab.fixture.links.iter().enumerate() {
        sqlx::query("UPDATE email_links SET email_address=CASE WHEN $2 THEN substring(macro_id FROM 7) ELSE email_address END,created_at='2026-01-01'::timestamptz + $3 * interval '1 day',updated_at='2026-01-01' WHERE id=$1")
            .bind(link).bind(i != 2).bind(i as i32).execute(&lab.db).await.expect("inbox fixture");
    }
    // Initial watch succeeds; first-login token discovery stops at the local
    // credential rejection, before the fixed public Google token-info URL.
    lab.stub.reply_sequence(
        "GET",
        "/internal/google_access_token",
        vec![
            (200, json!({"access_token":"fake-access-token"})),
            (401, json!({"message":"no discovery credential in parity"})),
        ],
    );
    lab.stub.reply(
        "POST",
        "/internal/relocate_inbox_grant",
        200,
        json!({"shared_fusionauth_user_id":"shared-provider-principal"}),
    );
    (lab, redis)
}

#[expect(clippy::disallowed_methods, reason = "Suite-local consent fixture")]
async fn attempt(
    lab: &Lab,
    owner: usize,
    email: Option<&str>,
    provider: &str,
    requested: &[&str],
    granted: &[&str],
) {
    sqlx::query("INSERT INTO in_progress_user_link(id,macro_user_id,email_provider,linked_email,requested_google_scopes,granted_google_scopes) VALUES ($1,$2,$3::email_user_provider_enum,$4,$5,$6)")
        .bind(ATTEMPT).bind(lab.fixture.fusion[owner].parse::<Uuid>().expect("owner UUID"))
        .bind(provider).bind(email).bind(requested).bind(granted).execute(&lab.db).await.expect("consent attempt");
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local subscription fixture"
)]
async fn professional(lab: &Lab, owner: usize) {
    sqlx::query("INSERT INTO \"RolesOnUsers\" (\"userId\",\"roleId\") VALUES ($1,'professional_subscriber') ON CONFLICT DO NOTHING")
        .bind(&lab.fixture.users[owner]).execute(&lab.db).await.expect("professional permission");
}

async fn init(lab: &mut Lab, step: &str, auth: Auth, query: &str, status: u16) {
    assert_eq!(
        lab.request(
            step,
            "POST",
            &format!("/email/init{query}"),
            auth,
            RequestBody::Empty
        )
        .await,
        status,
        "{step}"
    );
}

fn query() -> String {
    format!("?link_id={ATTEMPT}")
}

#[expect(
    clippy::disallowed_methods,
    reason = "Fault injection uses runtime test SQL"
)]
async fn sql(lab: &Lab, statement: &str) {
    sqlx::raw_sql(statement)
        .execute(&lab.db)
        .await
        .expect("suite SQL");
}

async fn fail_write(lab: &Lab, table: &str, operation: &str, deferred: bool) {
    let trigger = if deferred {
        format!(
            "CREATE CONSTRAINT TRIGGER parity_fault AFTER {operation} ON {table} DEFERRABLE INITIALLY DEFERRED"
        )
    } else {
        format!("CREATE TRIGGER parity_fault BEFORE {operation} ON {table}")
    };
    sql(lab, &format!("CREATE FUNCTION parity_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'parity injected write failure'; END $$; {trigger} FOR EACH ROW EXECUTE FUNCTION parity_fault();")).await;
}
