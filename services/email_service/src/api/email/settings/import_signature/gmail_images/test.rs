use super::{GmailMessageImage, GmailSignatureImages};
use crate::util::process_pre_insert::sfs_map::ImageSource;
use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use email_api_client::GmailApiClientRepository;
use email_api_client::domain::models::{AccessToken, TokenError, TokenFreshness};
use email_api_client::domain::ports::{AlwaysAllowRateLimiter, ProviderTokenSource};
use email_api_client::domain::service::EmailApiClientServiceImpl;
use models_email::service::link::Link;
use serde_json::json;
use tokio::net::TcpListener;
use uuid::Uuid;

/// The shape Gmail returns in `sendAs[].signature` for images pasted into the
/// signature editor from a message, with made-up ids.
const EMBEDDED_URL: &str = "https://mail.google.com/mail/u/0?ui=2&ik=0a1b2c3d4e&attid=0.1&permmsgid=msg-f:1849112233445566778&th=19a95dc7805a293a&view=fimg&fur=ip&permmsgid=msg-f:1849112233445566778&sz=s0-l75-ft&attbid=ANGjdJ_example&disp=emb&realattid=ii_0000000000000000a1b2&zw";
/// `msg-f:1849112233445566778` in hex, as the Gmail API names the message.
const MESSAGE_ID: &str = "19a95dc7805a293a";
const CONTENT_ID: &str = "ii_0000000000000000a1b2";
const ATTACHMENT_ID: &str = "ANGjdJ-attachment";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nsignature-logo";

#[test]
fn parses_message_and_part_from_embedded_url() {
    assert_eq!(
        GmailMessageImage::parse(EMBEDDED_URL),
        Some(GmailMessageImage {
            message_id: MESSAGE_ID.to_string(),
            content_id: CONTENT_ID.to_string(),
        })
    );
}

#[test]
fn falls_back_to_th_when_url_has_no_permanent_message_id() {
    let url = "https://mail.google.com/mail/u/0/?ui=2&ik=abc&view=fimg&th=17a2b3c4d5e6f708&attid=0.1&disp=emb&realattid=ii_kq1&attbid=xyz";
    assert_eq!(
        GmailMessageImage::parse(url),
        Some(GmailMessageImage {
            message_id: "17a2b3c4d5e6f708".to_string(),
            content_id: "ii_kq1".to_string(),
        })
    );
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
        // A message id that isn't Gmail's hex id never reaches the API path.
        "https://mail.google.com/mail/u/0?th=..%2Fdrafts&realattid=ii_1",
        "https://mail.google.com/mail/u/0?permmsgid=msg-a:r-123&realattid=ii_1",
    ] {
        assert_eq!(GmailMessageImage::parse(url), None, "{url}");
    }
}

#[tokio::test]
async fn reads_embedded_image_from_the_inbox_mailbox() {
    let fake = FakeGmail::start().await;
    let images = GmailSignatureImages {
        email_api: &fake.api,
        link_id: Uuid::now_v7(),
    };

    let image = images.fetch(EMBEDDED_URL).await.unwrap();

    assert_eq!(image.as_deref(), Some(PNG));
}

#[tokio::test]
async fn leaves_image_unresolved_when_mailbox_lacks_it() {
    let fake = FakeGmail::start().await;
    let images = GmailSignatureImages {
        email_api: &fake.api,
        link_id: Uuid::now_v7(),
    };

    let other_part = EMBEDDED_URL.replace(CONTENT_ID, "ii_other");
    let other_message = EMBEDDED_URL
        .replace("1849112233445566778", "1849112233445566779")
        .replace(MESSAGE_ID, "19a95dc7805a293b");

    assert_eq!(images.fetch(&other_part).await.unwrap(), None);
    assert_eq!(images.fetch(&other_message).await.unwrap(), None);
}

#[tokio::test]
async fn fetches_other_images_over_public_http() {
    let fake = FakeGmail::start().await;
    let images = GmailSignatureImages {
        email_api: &fake.api,
        link_id: Uuid::now_v7(),
    };

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

/// The real Gmail adapter over a local server holding one message whose
/// inline image has [`CONTENT_ID`], plus a public image route.
struct FakeGmail {
    api: FakeApi,
    origin: String,
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
        let app = Router::new()
            .route("/gmail/v1/users/me/messages/{id}", get(message))
            .route(
                "/gmail/v1/users/me/messages/{id}/attachments/{attachment_id}",
                get(attachment),
            )
            .route("/public/logo.png", get(|| async { PNG }));
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
            server,
        }
    }
}

async fn message(Path(id): Path<String>) -> Response {
    if id != MESSAGE_ID {
        return StatusCode::NOT_FOUND.into_response();
    }
    let html = URL_SAFE_NO_PAD.encode(format!(r#"<img src="cid:{CONTENT_ID}">"#));
    Json(json!({
        "id": MESSAGE_ID,
        "threadId": MESSAGE_ID,
        "labelIds": ["SENT"],
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
            "parts": [
                {
                    "partId": "0",
                    "mimeType": "text/html",
                    "filename": "",
                    "headers": [],
                    "body": { "size": 32, "data": html }
                },
                {
                    "partId": "1",
                    "mimeType": "image/png",
                    "filename": "logo.png",
                    "headers": [
                        { "name": "Content-Type", "value": "image/png; name=\"logo.png\"" },
                        { "name": "Content-Disposition", "value": "inline; filename=\"logo.png\"" },
                        { "name": "Content-ID", "value": format!("<{CONTENT_ID}>") },
                        { "name": "X-Attachment-Id", "value": CONTENT_ID }
                    ],
                    "body": { "size": PNG.len(), "attachmentId": ATTACHMENT_ID }
                }
            ]
        }
    }))
    .into_response()
}

async fn attachment(Path((id, attachment_id)): Path<(String, String)>) -> Response {
    if id != MESSAGE_ID || attachment_id != ATTACHMENT_ID {
        return StatusCode::NOT_FOUND.into_response();
    }
    Json(json!({ "size": PNG.len(), "data": URL_SAFE_NO_PAD.encode(PNG) })).into_response()
}
