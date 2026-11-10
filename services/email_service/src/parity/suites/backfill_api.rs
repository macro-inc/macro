//! Legacy backfill HTTP contracts, recorded before moving the handlers.
use crate::parity::lab::{Auth, Lab, LabOptions, RequestBody};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

mod cancel;
mod create;
mod faults;
mod reads;

const PUBLIC: &str = "/email/backfill/gmail";
const INTERNAL: &str = "/internal/backfill/provider/gmail";
const OUTLOOK: Uuid = Uuid::from_u128(0x5800_0000_0000_0000_0000_0000_0000_0002);
const MISSING: Uuid = Uuid::from_u128(0x9000_0000_0000_0000_0000_0000_0000_0001);

#[expect(clippy::disallowed_methods, reason = "Suite-local runtime fixture SQL")]
async fn start(pool: PgPool, name: &'static str, shard: u32) -> Lab {
    let mut lab = Lab::start(
        pool,
        LabOptions {
            suite: "backfill_api",
            name,
            shard,
            gmail_label_write_batches: false,
        },
    )
    .await;
    lab.transcript.normalizer.sort_response_keys = true;
    lab.transcript.normalizer.symbol(MISSING, "<missing>");
    lab.transcript
        .normalizer
        .symbol("macro|INTERNAL@macro.com", "<user:internal>");
    for (index, link) in lab.fixture.links.iter().enumerate() {
        sqlx::query("UPDATE email_links SET email_address=CASE WHEN $2 THEN substring(macro_id FROM 7) ELSE email_address END, created_at='2026-01-01'::timestamptz + $3 * interval '1 day' WHERE id=$1")
            .bind(link).bind(index != 2).bind(index as i32).execute(&lab.db).await.expect("inbox selection");
    }
    lab.transcript.normalizer.symbol(OUTLOOK, "<link:outlook>");
    sqlx::query("INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,is_sync_active,created_at) VALUES ($1,$2,$3,'outlook@example.com','OUTLOOK',true,'2026-01-04')")
        .bind(OUTLOOK).bind(&lab.fixture.users[0]).bind(&lab.fixture.fusion[0]).execute(&lab.db).await.expect("Outlook fixture");
    lab
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local runtime job fixture SQL"
)]
async fn job(lab: &mut Lab, index: u32, inbox: Option<usize>, status: &str) -> Uuid {
    let id = Uuid::from_u128(
        0x5700_0000_0000_0000_0000_0000_0000_0000
            + (lab.fixture.links[0].as_u128() & 0xffff_ffff) * 1000
            + u128::from(index),
    );
    lab.transcript
        .normalizer
        .symbol(id, format!("<job:{index}>"));
    sqlx::query("INSERT INTO email_backfill_jobs (id,link_id,fusionauth_user_id,status,threads_requested_limit,total_threads,threads_retrieved_count,created_at,updated_at) VALUES ($1,$2,$3,$4::email_backfill_job_status,$5,$6,$7,'2026-02-01'::timestamptz + $8 * interval '1 minute','2026-02-02')")
        .bind(id).bind(inbox.map(|i| if i == 3 { OUTLOOK } else { lab.fixture.links[i] })).bind(&lab.fixture.fusion[if inbox == Some(1) { 1 } else { 0 }])
        .bind(status).bind(Some(37_i32)).bind(29_i32).bind(11_i32).bind(index as i32)
        .execute(&lab.db).await.expect("backfill job");
    id
}

async fn request(
    lab: &mut Lab,
    step: &str,
    method: &str,
    path: &str,
    auth: Auth,
    inbox: Option<Uuid>,
    body: Value,
    status: u16,
) {
    let value = inbox.map(|id| id.to_string());
    let headers: Vec<_> = value
        .as_ref()
        .map(|id| ("x-email-link-id", id.as_bytes()))
        .into_iter()
        .collect();
    let body = if method == "GET" {
        RequestBody::Empty
    } else {
        RequestBody::Json(body)
    };
    assert_eq!(
        lab.request_with_headers(step, method, path, auth, body, &headers)
            .await,
        status,
        "{step}"
    );
}
