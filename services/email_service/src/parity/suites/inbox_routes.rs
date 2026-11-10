//! Inbox-scoped HTTP characterization on the original handlers.
use crate::parity::lab::{Auth, Lab, LabOptions, RequestBody};
use crate::parity::transcript::response_order::ResponseArrayRule;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

mod access;
mod calendar;
mod calendar_faults;
mod contacts;
mod faults;
mod fixture;
mod images;
mod scheduled;
mod settings;
mod signature;

const SETTINGS: &str = "/email/settings";
const IMPORT: &str = "/email/settings/import-signature";
const SCHEDULED: &str = "/email/drafts/scheduled";
const CONTACTS: &str = "/email/contacts";
const MISSING: Uuid = Uuid::from_u128(0x9000_0000_0000_0000_0000_0000_0000_0001);

async fn start(pool: PgPool, name: &'static str, shard: u32) -> Lab {
    let mut lab = Lab::start(
        pool,
        LabOptions {
            suite: "inbox_routes",
            name,
            shard,
            gmail_label_write_batches: false,
        },
    )
    .await;
    lab.transcript.normalizer.sort_response_keys = true;
    lab.transcript.response_array_rules = &[ResponseArrayRule::ScheduledMessageFields];
    lab.transcript.normalizer.symbol(MISSING, "<missing>");
    lab.transcript
        .normalizer
        .symbol("macro|INTERNAL@macro.com", "<user:internal>");
    fixture::seed(&mut lab, shard).await;
    lab
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
    let body = if method == "PATCH" {
        RequestBody::Json(body)
    } else {
        RequestBody::Empty
    };
    assert_eq!(
        lab.request_with_headers(step, method, path, auth, body, &headers)
            .await,
        status,
        "{step}"
    );
}
