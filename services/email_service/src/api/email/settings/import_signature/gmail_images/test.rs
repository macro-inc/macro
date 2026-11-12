use super::{GmailMessageImage, GmailSignatureImages, ImageLocation};
use crate::util::process_pre_insert::sfs_map::ImageSource;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use email_api_client::GmailApiClientRepository;
use email_api_client::domain::models::{AccessToken, EmailApiError, TokenError, TokenFreshness};
use email_api_client::domain::ports::{AlwaysAllowRateLimiter, ProviderTokenSource};
use email_api_client::domain::service::EmailApiClientServiceImpl;
use models_email::service::link::Link;
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tokio::net::TcpListener;
use uuid::Uuid;

/// The shape Gmail returns in `sendAs[].signature` for images pasted into the
/// signature editor from a message, with made-up ids.
const EMBEDDED_URL: &str = "https://mail.google.com/mail/u/0?ui=2&ik=0a1b2c3d4e&attid=0.1&permmsgid=msg-f:1849112233445566778&th=19a95dc7805a293a&view=fimg&fur=ip&permmsgid=msg-f:1849112233445566778&sz=s0-l75-ft&attbid=ANGjdJ_example&disp=emb&realattid=ii_0000000000000000a1b2&zw";
/// `msg-f:1849112233445566778` in hex, as the Gmail API names the message.
const MESSAGE_ID: &str = "19a95dc7805a293a";
const CONTENT_ID: &str = "ii_0000000000000000a1b2";
const ATTACHMENT_ID: &str = "ANGjdJ-logo";
/// A second image in the same message.
const ICON_CONTENT_ID: &str = "ii_0000000000000000c3d4";
const ICON_ATTACHMENT_ID: &str = "ANGjdJ-icon";
/// A thread whose second message, one the mailbox sent, holds an image.
const THREAD_ID: &str = "19a95dc7805a0001";
const SENT_MESSAGE_ID: &str = "19a95dc7805a0002";
const SENT_CONTENT_ID: &str = "ii_0000000000000000e5f6";
const SENT_ATTACHMENT_ID: &str = "ANGjdJ-sent";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nsignature-logo";

fn embedded_url(location: &str, content_id: &str) -> String {
    format!(
        "https://mail.google.com/mail/u/0?ui=2&ik=0a1b2c3d4e&attid=0.1&{location}&view=fimg&disp=emb&realattid={content_id}&attbid=ANGjdJ_example"
    )
}

#[test]
fn parses_message_and_part_from_embedded_url() {
    assert_eq!(
        GmailMessageImage::parse(EMBEDDED_URL),
        Some(GmailMessageImage {
            location: ImageLocation::Message(MESSAGE_ID.to_string()),
            content_id: CONTENT_ID.to_string(),
        })
    );
}

#[test]
fn looks_in_the_thread_without_a_permanent_message_id() {
    for location in [
        format!("th={THREAD_ID}"),
        format!("permmsgid=msg-a:r-1234567890&th={THREAD_ID}"),
    ] {
        assert_eq!(
            GmailMessageImage::parse(&embedded_url(&location, SENT_CONTENT_ID)),
            Some(GmailMessageImage {
                location: ImageLocation::Thread(THREAD_ID.to_string()),
                content_id: SENT_CONTENT_ID.to_string(),
            }),
            "{location}"
        );
    }
}

#[test]
fn ignores_urls_that_are_not_gmail_embedded_images() {
    for url in [
        "https://example.com/logo.png",
        "https://ci3.googleusercontent.com/mail-sig/AIorK4z",
        // No part to look for.
        "https://mail.google.com/mail/u/0?ui=2&permmsgid=msg-f:1849112233445566778&view=fimg",
        // Not over HTTPS.
        "http://mail.google.com/mail/u/0?permmsgid=msg-f:1849112233445566778&realattid=ii_1",
        // An id that isn't Gmail's hex id never reaches the API path.
        "https://mail.google.com/mail/u/0?th=..%2Fdrafts&realattid=ii_1",
        "https://mail.google.com/mail/u/0?permmsgid=msg-a:r-123&realattid=ii_1",
    ] {
        assert_eq!(GmailMessageImage::parse(url), None, "{url}");
    }
}

#[tokio::test]
async fn reads_embedded_image_from_the_inbox_mailbox() {
    let fake = FakeGmail::start().await;
    let images = GmailSignatureImages::new(&fake.api, Uuid::now_v7());

    let image = images.fetch(EMBEDDED_URL).await.unwrap();

    assert_eq!(image.as_deref(), Some(PNG));
}

#[tokio::test]
async fn reads_a_message_once_for_all_its_images() {
    let fake = FakeGmail::start().await;
    let images = GmailSignatureImages::new(&fake.api, Uuid::now_v7());
    let icon_url = embedded_url("permmsgid=msg-f:1849112233445566778", ICON_CONTENT_ID);

    let (logo, icon) = tokio::join!(images.fetch(EMBEDDED_URL), images.fetch(&icon_url));

    assert_eq!(logo.unwrap().as_deref(), Some(PNG));
    assert_eq!(icon.unwrap().as_deref(), Some(PNG));
    assert_eq!(fake.state.message_reads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn finds_an_image_in_a_message_the_mailbox_sent() {
    let fake = FakeGmail::start().await;
    let images = GmailSignatureImages::new(&fake.api, Uuid::now_v7());
    let url = embedded_url(
        &format!("permmsgid=msg-a:r-1234567890&th={THREAD_ID}"),
        SENT_CONTENT_ID,
    );

    let image = images.fetch(&url).await.unwrap();

    assert_eq!(image.as_deref(), Some(PNG));
}

#[tokio::test]
async fn reads_th_as_a_message_when_no_thread_has_that_id() {
    let fake = FakeGmail::start().await;
    let images = GmailSignatureImages::new(&fake.api, Uuid::now_v7());

    let image = images
        .fetch(&embedded_url(&format!("th={MESSAGE_ID}"), CONTENT_ID))
        .await
        .unwrap();

    assert_eq!(image.as_deref(), Some(PNG));
}

#[tokio::test]
async fn leaves_image_unresolved_when_mailbox_lacks_it() {
    let fake = FakeGmail::start().await;
    let images = GmailSignatureImages::new(&fake.api, Uuid::now_v7());

    let other_part = EMBEDDED_URL.replace(CONTENT_ID, "ii_other");
    let other_message = embedded_url("permmsgid=msg-f:1849112233445566779", CONTENT_ID);

    assert_eq!(images.fetch(&other_part).await.unwrap(), None);
    assert_eq!(images.fetch(&other_message).await.unwrap(), None);
    assert_eq!(images.into_retryable_failure(), None);
}

#[tokio::test]
async fn reports_a_rate_limited_read_as_retryable() {
    let fake = FakeGmail::start().await;
    fake.state.rate_limited.store(true, Ordering::SeqCst);
    let images = GmailSignatureImages::new(&fake.api, Uuid::now_v7());

    assert!(images.fetch(EMBEDDED_URL).await.is_err());
    assert!(matches!(
        images.into_retryable_failure(),
        Some(EmailApiError::RateLimited { .. })
    ));
}

#[tokio::test]
async fn stops_reading_gmail_after_a_retryable_failure() {
    let fake = FakeGmail::start().await;
    fake.state.rate_limited.store(true, Ordering::SeqCst);
    let images = GmailSignatureImages::new(&fake.api, Uuid::now_v7());
    let icon_url = embedded_url("permmsgid=msg-f:1849112233445566778", ICON_CONTENT_ID);

    assert!(images.fetch(EMBEDDED_URL).await.is_err());
    assert_eq!(images.fetch(&icon_url).await.unwrap(), None);
    assert_eq!(fake.state.message_reads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn keeps_gmail_image_copies_out_of_the_shared_mapping() {
    let fake = FakeGmail::start().await;
    let images = GmailSignatureImages::new(&fake.api, Uuid::now_v7());

    assert!(!images.is_public(EMBEDDED_URL));
    assert!(images.is_public("https://example.com/logo.png"));
}

#[tokio::test]
async fn fetches_other_images_over_public_http() {
    let fake = FakeGmail::start().await;
    let images = GmailSignatureImages::new(&fake.api, Uuid::now_v7());

    let image = images
        .fetch(&format!("{}/public/logo.png", fake.origin))
        .await
        .unwrap();

    assert_eq!(image.as_deref(), Some(PNG));
}

struct StaticToken;

impl ProviderTokenSource for StaticToken {
    async fn get_access_token(
        &self,
        _: Uuid,
        _: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        Ok(AccessToken::new("token"))
    }

    async fn get_access_token_for_link(
        &self,
        _: &Link,
        _: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        Ok(AccessToken::new("token"))
    }

    async fn get_access_token_health_neutral(
        &self,
        _: &Link,
        _: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        Ok(AccessToken::new("token"))
    }
}

type FakeApi =
    EmailApiClientServiceImpl<GmailApiClientRepository, StaticToken, AlwaysAllowRateLimiter>;

#[derive(Default)]
struct GmailState {
    message_reads: AtomicUsize,
    rate_limited: AtomicBool,
}

/// The real Gmail adapter over a local server: [`MESSAGE_ID`] holds two inline
/// images, [`THREAD_ID`] a sent message with one, plus a public image route.
struct FakeGmail {
    api: FakeApi,
    origin: String,
    state: Arc<GmailState>,
    server: tokio::task::JoinHandle<()>,
}

impl Drop for FakeGmail {
    fn drop(&mut self) {
        self.server.abort();
    }
}

impl FakeGmail {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let state = Arc::new(GmailState::default());
        let app = Router::new()
            .route("/gmail/v1/users/me/messages/{id}", get(message))
            .route("/gmail/v1/users/me/threads/{id}", get(thread))
            .route(
                "/gmail/v1/users/me/messages/{id}/attachments/{attachment_id}",
                get(attachment),
            )
            .route("/public/logo.png", get(|| async { PNG }))
            .with_state(state.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = gmail_client::GmailClient::new_with_urls(
            None,
            format!("{origin}/gmail/v1"),
            format!("{origin}/people"),
            format!("{origin}/certs"),
            "test".to_string(),
        );
        let api = EmailApiClientServiceImpl::new(
            GmailApiClientRepository::new(client),
            StaticToken,
            AlwaysAllowRateLimiter,
        );
        Self {
            api,
            origin,
            state,
            server,
        }
    }
}

/// A Gmail `messages.get` resource whose HTML body shows each inline image.
fn message_json(id: &str, thread_id: &str, images: &[(&str, &str)]) -> Value {
    let html = images
        .iter()
        .map(|(content_id, _)| format!(r#"<img src="cid:{content_id}">"#))
        .collect::<String>();
    let mut parts = vec![json!({
        "partId": "0",
        "mimeType": "text/html",
        "filename": "",
        "headers": [],
        "body": { "size": html.len(), "data": URL_SAFE_NO_PAD.encode(&html) }
    })];
    for (index, (content_id, attachment_id)) in images.iter().enumerate() {
        parts.push(json!({
            "partId": (index + 1).to_string(),
            "mimeType": "image/png",
            "filename": "image.png",
            "headers": [
                { "name": "Content-Type", "value": "image/png; name=\"image.png\"" },
                { "name": "Content-Disposition", "value": "inline; filename=\"image.png\"" },
                { "name": "Content-ID", "value": format!("<{content_id}>") },
                { "name": "X-Attachment-Id", "value": content_id }
            ],
            "body": { "size": PNG.len(), "attachmentId": attachment_id }
        }));
    }
    json!({
        "id": id,
        "threadId": thread_id,
        "labelIds": ["INBOX"],
        "snippet": "",
        "sizeEstimate": 1024,
        "historyId": "1",
        "internalDate": "1767225600000",
        "payload": {
            "partId": "",
            "mimeType": "multipart/related",
            "filename": "",
            "headers": [{ "name": "Subject", "value": "Logo" }],
            "body": { "size": 0 },
            "parts": parts
        }
    })
}

async fn message(State(state): State<Arc<GmailState>>, Path(id): Path<String>) -> Response {
    state.message_reads.fetch_add(1, Ordering::SeqCst);
    if state.rate_limited.load(Ordering::SeqCst) {
        let body = json!({ "error": { "code": 429, "message": "Rate Limit Exceeded" } });
        return (StatusCode::TOO_MANY_REQUESTS, Json(body)).into_response();
    }
    if id != MESSAGE_ID {
        return StatusCode::NOT_FOUND.into_response();
    }
    Json(message_json(
        MESSAGE_ID,
        MESSAGE_ID,
        &[
            (CONTENT_ID, ATTACHMENT_ID),
            (ICON_CONTENT_ID, ICON_ATTACHMENT_ID),
        ],
    ))
    .into_response()
}

async fn thread(Path(id): Path<String>) -> Response {
    if id != THREAD_ID {
        return StatusCode::NOT_FOUND.into_response();
    }
    Json(json!({
        "id": THREAD_ID,
        "messages": [
            message_json(THREAD_ID, THREAD_ID, &[]),
            message_json(SENT_MESSAGE_ID, THREAD_ID, &[(SENT_CONTENT_ID, SENT_ATTACHMENT_ID)]),
        ]
    }))
    .into_response()
}

async fn attachment(Path((id, attachment_id)): Path<(String, String)>) -> Response {
    let known = [
        (MESSAGE_ID, ATTACHMENT_ID),
        (MESSAGE_ID, ICON_ATTACHMENT_ID),
        (SENT_MESSAGE_ID, SENT_ATTACHMENT_ID),
    ];
    if !known.contains(&(id.as_str(), attachment_id.as_str())) {
        return StatusCode::NOT_FOUND.into_response();
    }
    Json(json!({ "size": PNG.len(), "data": URL_SAFE_NO_PAD.encode(PNG) })).into_response()
}
