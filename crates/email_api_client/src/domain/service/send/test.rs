use models_email::email::service::address::ContactInfo;
use models_email::email::service::message::MessageToSend;
use uuid::Uuid;

use super::super::super::models::{AccessToken, SendRequest, SentIds, TokenFreshness};
use super::super::super::ports::MailboxSendClient;
use super::super::test_support::{Call, FakeRateLimiter, FakeTokenSource, call_log};
use super::EmailApiClientServiceImpl;

#[derive(Clone)]
struct SendClient {
    calls: super::super::test_support::CallLog,
}

impl MailboxSendClient for SendClient {
    async fn send_message(
        &self,
        access_token: &AccessToken,
        request: &SendRequest,
        provider_thread_id: Option<&str>,
    ) -> Result<SentIds, super::super::super::models::EmailApiError> {
        assert_eq!(access_token.expose_secret(), "access-token");
        assert_eq!(request.message.subject, "subject");
        assert_eq!(provider_thread_id, Some("thread-1"));
        self.calls
            .lock()
            .unwrap()
            .push(Call::Repository("send_message"));
        Ok(SentIds {
            provider_message_id: "message-1".to_string(),
            provider_thread_id: "thread-1".to_string(),
        })
    }
}

#[tokio::test]
async fn send_uses_send_cost_and_returns_ids_without_mutating_message() {
    let calls = call_log();
    let service = EmailApiClientServiceImpl::new(
        SendClient {
            calls: calls.clone(),
        },
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("access-token"))),
        FakeRateLimiter::new(calls.clone(), Ok(())),
    );
    let request = send_request();

    let sent_ids = service
        .send_message(Uuid::nil(), &request, Some("thread-1"))
        .await
        .unwrap();

    assert_eq!(sent_ids.provider_message_id, "message-1");
    assert_eq!(sent_ids.provider_thread_id, "thread-1");
    assert_eq!(request.message.provider_id, None);
    assert_eq!(request.message.provider_thread_id, None);
    assert_eq!(request.message.subject, "subject");
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::RateLimit(Uuid::nil(), super::ApiOperationKind::SendMessage),
            Call::Token(Uuid::nil(), TokenFreshness::Cached),
            Call::Repository("send_message"),
        ]
    );
}

fn send_request() -> SendRequest {
    SendRequest {
        message: MessageToSend {
            db_id: None,
            provider_id: None,
            replying_to_id: None,
            provider_thread_id: None,
            thread_db_id: None,
            link_id: Uuid::nil(),
            subject: "subject".to_string(),
            to: None,
            cc: None,
            bcc: None,
            body_text: Some("body".to_string()),
            body_html: None,
            body_macro: None,
            attachments: None,
            headers_json: None,
            send_time: None,
        },
        from: ContactInfo {
            email: "sender@example.com".to_string(),
            name: None,
            photo_url: None,
        },
        parent_message_id: None,
        references: None,
    }
}
