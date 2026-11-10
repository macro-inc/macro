//! Rich content is opt-in: the label fixtures and their goldens stay unchanged.
use crate::parity::lab::{Auth, Lab, LabOptions, RequestBody};
use crate::parity::transcript::response_order::ResponseArrayRule;
use crate::pubsub::label_write_sim::world;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

pub(super) const MISSING: Uuid = Uuid::from_u128(0x9000_0000_0000_0000_0000_0000_0000_0001);

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local fixture SQL is deliberately uncached"
)]
pub(super) async fn start(
    pool: PgPool,
    suite: &'static str,
    name: &'static str,
    shard: u32,
) -> Lab {
    let mut lab = Lab::start(
        pool,
        LabOptions {
            suite,
            name,
            shard,
            gmail_label_write_batches: false,
        },
    )
    .await;
    lab.transcript.normalizer.sort_response_keys = true;
    lab.transcript.response_array_rules = &[
        ResponseArrayRule::MessageLabelsByProviderId,
        ResponseArrayRule::MessageRecipientsByAddress,
        ResponseArrayRule::BatchMessagesById,
        ResponseArrayRule::ThreadTimestampTiesById,
    ];
    lab.transcript.normalizer.symbol(MISSING, "<missing>");
    // Pick a deterministic newest inbox for the legacy single-link summary reads.
    for (index, link) in lab.fixture.links.iter().enumerate() {
        sqlx::query("UPDATE email_links SET created_at = '2026-01-01'::timestamptz + $2 * interval '1 day' WHERE id = $1")
            .bind(link).bind(index as i32).execute(&lab.db).await.expect("link order");
    }
    for (index, (name, id)) in lab.fixture.messages.clone().into_iter().enumerate() {
        let link = if name.starts_with("a2") {
            lab.fixture.links[2]
        } else if name.starts_with('b') {
            lab.fixture.links[1]
        } else {
            lab.fixture.links[0]
        };
        let contact = Uuid::from_u128(
            0x5600_0000_0000_0000_0000_0000_0000_0000
                + (u128::from(shard) << 16)
                + index as u128 * 8,
        );
        lab.transcript
            .normalizer
            .symbol(contact, format!("<sender:{name}>"));
        sqlx::query("INSERT INTO email_contacts (id,link_id,email_address,name,original_photo_url,sfs_photo_url) VALUES ($1,$2,$3,$4,'https://example.com/original.png','https://example.com/photo.png')")
            .bind(contact).bind(link).bind(format!("sender-{name}@example.com")).bind(format!("Contact {name}"))
            .execute(&lab.db).await.expect("sender");
        sqlx::query("UPDATE email_messages SET subject=$2,snippet=$3,body_text=$4,body_html_sanitized=$5,body_macro='hidden macro body',from_contact_id=$6,from_name=$7,size_estimate=1234,global_id=$8,provider_history_id='history-42',sent_at=internal_date_ts,headers_jsonb=$9,has_attachments=true,is_sent=$10,draft_generation=$11 WHERE id=$1")
            .bind(id).bind(format!("Subject {name}")).bind(format!("Snippet {name}"))
            .bind(format!("Plain body {name}\nSecond line & details."))
            .bind((name != "m3a").then(|| format!("<p>HTML body <strong>{name}</strong> &amp; details.</p>")))
            .bind(contact).bind(format!("Header {name}")).bind(format!("<{name}@example.com>"))
            .bind(json!({"X-Fixture":"read parity","Reply-To":"reply@example.com"}))
            .bind(name == "m1b" || name == "a2b").bind(if name == "draft" { 7 } else { 0 })
            .execute(&lab.db).await.expect("message content");
        for (recipient_index, kind) in ["TO", "CC", "BCC"].into_iter().enumerate() {
            let recipient = Uuid::from_u128(contact.as_u128() + recipient_index as u128 + 1);
            lab.transcript
                .normalizer
                .symbol(recipient, format!("<{kind}:{name}>"));
            sqlx::query(
                "INSERT INTO email_contacts (id,link_id,email_address,name) VALUES ($1,$2,$3,$4)",
            )
            .bind(recipient)
            .bind(link)
            .bind(format!("{}-{name}@example.com", kind.to_lowercase()))
            .bind(format!("Contact {kind}"))
            .execute(&lab.db)
            .await
            .expect("recipient contact");
            sqlx::query("INSERT INTO email_message_recipients (message_id,contact_id,recipient_type,name) VALUES ($1,$2,$3::email_recipient_type,$4)")
                .bind(id).bind(recipient).bind(kind).bind(if kind == "CC" { None } else { Some(format!("Header {kind}")) })
                .execute(&lab.db).await.expect("recipient");
        }
        let attachment = Uuid::from_u128(contact.as_u128() + 4);
        lab.transcript
            .normalizer
            .symbol(attachment, format!("<attachment:{name}>"));
        sqlx::query("INSERT INTO email_attachments (id,message_id,provider_attachment_id,filename,mime_type,size_bytes,content_id) VALUES ($1,$2,'attachment-42','report.pdf','application/pdf',2048,'report@example.com')")
            .bind(attachment).bind(id).execute(&lab.db).await.expect("attachment");
    }
    let first = lab.fixture.messages["m1a"];
    let reply = lab.fixture.messages["m1b"];
    sqlx::query("UPDATE email_messages SET replying_to_id=$2 WHERE id=$1")
        .bind(reply)
        .bind(first)
        .execute(&lab.db)
        .await
        .expect("reply");
    sqlx::query("UPDATE email_messages SET replying_to_id=$2 WHERE id=$1")
        .bind(lab.fixture.messages["draft"])
        .bind(reply)
        .execute(&lab.db)
        .await
        .expect("draft reply");
    sqlx::query("INSERT INTO email_message_labels (message_id,label_id) VALUES ($1,$2)")
        .bind(reply)
        .bind(lab.fixture.labels["A/SENT"])
        .execute(&lab.db)
        .await
        .expect("sent label");
    lab
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local pagination fixture uses uncached SQL"
)]
pub(super) async fn pages(lab: &mut Lab, shard: u32) -> Uuid {
    let thread = world::thread_uuid(shard, 0);
    for (index, name) in [
        "page-old",
        "page-new",
        "page-newest",
        "null-date",
        "discarded",
        "retained",
    ]
    .into_iter()
    .enumerate()
    {
        let id = world::message_uuid(shard, 20 + index);
        lab.transcript
            .normalizer
            .symbol(id, format!("<msg:{name}>"));
        lab.fixture.messages.insert(name.into(), id);
        sqlx::query("INSERT INTO email_messages (id,thread_id,link_id,provider_id,subject,is_draft,internal_date_ts,mailbox_state) VALUES ($1,$2,$3,$4,$4,$5,CASE WHEN $6 THEN NULL ELSE '2026-11-01'::timestamptz + $7 * interval '1 day' END,$8)")
            .bind(id).bind(thread).bind(lab.fixture.links[0]).bind(name).bind(name == "discarded")
            .bind(name == "null-date").bind(index as i32)
            .bind(json!({"provider_missing": matches!(name, "discarded" | "retained")}))
            .execute(&lab.db).await.expect("page message");
    }
    thread
}

pub(super) async fn get(lab: &mut Lab, step: &str, path: &str, auth: Auth, status: u16) {
    assert_eq!(
        lab.request(step, "GET", path, auth, RequestBody::Empty)
            .await,
        status,
        "{step}"
    );
}

pub(super) async fn post(
    lab: &mut Lab,
    step: &str,
    path: &str,
    auth: Auth,
    body: serde_json::Value,
    status: u16,
) {
    assert_eq!(
        lab.request(step, "POST", path, auth, RequestBody::Json(body))
            .await,
        status,
        "{step}"
    );
}

pub(super) async fn rejected_bodies(
    lab: &mut Lab,
    path: &str,
    auth: Auth,
    invalid: serde_json::Value,
) {
    for (step, bytes, content_type, status) in [
        ("malformed JSON", b"[".to_vec(), "application/json", 400),
        (
            "missing JSON content type",
            b"[]".to_vec(),
            "text/plain",
            415,
        ),
        ("empty JSON body", vec![], "application/json", 400),
    ] {
        assert_eq!(
            lab.request(
                step,
                "POST",
                path,
                auth,
                RequestBody::Raw {
                    bytes,
                    content_type
                }
            )
            .await,
            status
        );
    }
    post(lab, "invalid UUID", path, auth, invalid, 422).await;
    post(lab, "wrong JSON shape", path, auth, json!(42), 422).await;
    post(lab, "null body", path, auth, json!(null), 422).await;
}

pub(super) async fn internal_auth(
    lab: &mut Lab,
    method: &str,
    path: &str,
    body: serde_json::Value,
) {
    for (name, auth, status) in [
        ("key without acting user", Auth::InternalKeyOnly, 200),
        ("missing credentials", Auth::MissingCredentials, 401),
        ("missing internal key", Auth::MissingInternalKey, 401),
        ("wrong internal key", Auth::WrongInternalKey, 401),
        ("invalid bearer", Auth::InvalidBearer, 401),
        ("user bearer is not internal", Auth::User(0), 403),
    ] {
        let body = if method == "GET" {
            RequestBody::Empty
        } else {
            RequestBody::Json(body.clone())
        };
        assert_eq!(
            lab.request(name, method, path, auth, body).await,
            status,
            "{name}"
        );
    }
}
