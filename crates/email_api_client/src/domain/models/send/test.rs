use chrono::{Duration, TimeZone, Utc};
use models_email::email::service::address::ContactInfo;
use models_email::email::service::attachment::AttachmentToSend;
use models_email::email::service::message::MessageToSend;
use uuid::Uuid;

use super::SendRequest;
use crate::domain::models::{
    AccessToken, EmailApiError, ProviderSubscription, RateLimitOrigin, SyncCursor,
};

fn contact(email: &str, name: &str) -> ContactInfo {
    ContactInfo {
        email: email.to_string(),
        name: Some(name.to_string()),
        photo_url: None,
    }
}

#[test]
fn access_token_debug_output_is_redacted() {
    let output = format!("{:?}", AccessToken::new("secret-token-value"));

    assert_eq!(output, "AccessToken([REDACTED])");
    assert!(!output.contains("secret-token-value"));
}

#[test]
fn email_api_error_identifies_transient_failures() {
    assert!(
        EmailApiError::Transient {
            message: "provider unavailable".to_string(),
        }
        .is_transient()
    );
    assert!(
        EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Local,
        }
        .is_transient()
    );
    assert!(
        !EmailApiError::Permanent {
            message: "invalid message".to_string(),
        }
        .is_transient()
    );
    assert!(!EmailApiError::OutdatedCursor.is_transient());
}

#[test]
fn gmail_cursor_preserves_opaque_history_id() {
    let cursor = SyncCursor::gmail("history-123");

    assert_eq!(cursor, SyncCursor::Gmail("history-123".to_string()));
    assert_eq!(cursor.as_str(), "history-123");
}

#[test]
fn provider_subscription_expires_at_provider_deadline() {
    let expires_at = Utc
        .with_ymd_and_hms(2026, 8, 5, 19, 0, 0)
        .single()
        .expect("valid timestamp");
    let subscription = ProviderSubscription::new(SyncCursor::gmail("42"), expires_at);

    assert!(!subscription.is_expired_at(expires_at - Duration::seconds(1)));
    assert!(subscription.is_expired_at(expires_at));
}

#[test]
fn mime_contains_recipients_threading_bodies_and_attachments() {
    let request = SendRequest {
        message: MessageToSend {
            db_id: None,
            provider_id: None,
            replying_to_id: None,
            provider_thread_id: Some("provider-thread".to_string()),
            thread_db_id: None,
            link_id: Uuid::nil(),
            subject: "Provider-neutral send".to_string(),
            to: Some(vec![contact("to@example.com", "To Recipient")]),
            cc: Some(vec![contact("cc@example.com", "Cc Recipient")]),
            bcc: Some(vec![contact("bcc@example.com", "Bcc Recipient")]),
            body_text: Some("Plain body".to_string()),
            body_html: Some("<strong>HTML body</strong>".to_string()),
            body_macro: None,
            attachments: Some(vec![AttachmentToSend {
                file_name: "notes.txt".to_string(),
                content_type: "text/plain".to_string(),
                data: b"attachment contents".to_vec(),
            }]),
            headers_json: None,
            send_time: None,
        },
        from: contact("sender@example.com", "Sender"),
        parent_message_id: Some("parent@example.com".to_string()),
        references: Some(vec![
            "root@example.com".to_string(),
            "parent@example.com".to_string(),
        ]),
    };

    let mime = String::from_utf8(request.build_mime().expect("MIME should build"))
        .expect("generated MIME should be UTF-8 for this fixture");

    assert!(mime.contains("From:"));
    assert!(mime.contains("sender@example.com"));
    assert!(mime.contains("To:"));
    assert!(mime.contains("to@example.com"));
    assert!(mime.contains("Cc:"));
    assert!(mime.contains("cc@example.com"));
    assert!(mime.contains("Bcc:"));
    assert!(mime.contains("bcc@example.com"));
    assert!(mime.contains("In-Reply-To: <parent@example.com>"));
    assert!(mime.contains("References: <root@example.com> <parent@example.com>"));
    assert!(mime.contains("Plain body"));
    assert!(mime.contains("<strong>HTML body</strong>"));
    assert!(mime.contains("filename=\"notes.txt\""));
    assert!(mime.contains("attachment contents") || mime.contains("YXR0YWNobWVudCBjb250ZW50cw=="));
}
