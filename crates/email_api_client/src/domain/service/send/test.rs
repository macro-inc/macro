use models_email::email::service::address::ContactInfo;
use models_email::email::service::message::MessageToSend;
use uuid::Uuid;

use super::super::super::models::{
    AccessToken, EmailApiError, RateLimitRefusal, SendRequest, SentIds, TokenFreshness,
};
use super::super::super::ports::{MailboxSendClient, MailboxSendRecoveryClient};
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

impl MailboxSendRecoveryClient for SendClient {
    async fn send_prepared(
        &self,
        token: &AccessToken,
        mime: &[u8],
        thread: Option<&str>,
    ) -> Result<SentIds, EmailApiError> {
        assert_eq!(token.expose_secret(), "access-token");
        assert_eq!(thread, Some("thread-1"));
        assert!(String::from_utf8_lossy(mime).contains("Message-ID: <attempt@example.com>"));
        self.calls
            .lock()
            .unwrap()
            .push(Call::Repository("send_prepared"));
        Ok(SentIds {
            provider_message_id: "message-1".into(),
            provider_thread_id: "thread-1".into(),
        })
    }

    async fn find_sent_message(
        &self,
        token: &AccessToken,
        id: &str,
    ) -> Result<Option<SentIds>, EmailApiError> {
        assert_eq!(token.expose_secret(), "access-token");
        assert_eq!(id, "attempt@example.com");
        self.calls
            .lock()
            .unwrap()
            .push(Call::Repository("find_sent_message"));
        Ok(Some(SentIds {
            provider_message_id: "message-1".into(),
            provider_thread_id: "thread-1".into(),
        }))
    }
}

#[tokio::test]
async fn preparation_never_dispatches_and_dispatch_does_not_repeat_preparation() {
    let calls = call_log();
    let service = EmailApiClientServiceImpl::new(
        SendClient {
            calls: calls.clone(),
        },
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("access-token"))),
        FakeRateLimiter::new(calls.clone(), Ok(())),
    );
    let mut request = send_request();
    request.message_id = Some("attempt@example.com".into());
    let prepared = service
        .prepare_send(Uuid::nil(), &request, Some("thread-1"))
        .await
        .unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        [
            Call::RateLimit(Uuid::nil(), super::ApiOperationKind::SendMessage),
            Call::Token(Uuid::nil(), TokenFreshness::Cached),
        ]
    );
    service.send_prepared(&prepared).await.unwrap();
    assert_eq!(calls.lock().unwrap().len(), 3);
    assert_eq!(calls.lock().unwrap()[2], Call::Repository("send_prepared"));
}

#[tokio::test]
async fn quota_refusal_is_a_preparation_error_before_token_or_dispatch() {
    let calls = call_log();
    let service = EmailApiClientServiceImpl::new(
        SendClient {
            calls: calls.clone(),
        },
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("access-token"))),
        FakeRateLimiter::new(calls.clone(), Err(RateLimitRefusal { retry_after: None })),
    );
    let error = service
        .prepare_send(Uuid::nil(), &send_request(), None)
        .await
        .err()
        .unwrap();
    assert!(matches!(error, EmailApiError::RateLimited { .. }));
    assert_eq!(
        *calls.lock().unwrap(),
        [Call::RateLimit(
            Uuid::nil(),
            super::ApiOperationKind::SendMessage
        )]
    );
}

#[tokio::test]
async fn recovery_uses_read_quota_and_does_not_send() {
    let calls = call_log();
    let service = EmailApiClientServiceImpl::new(
        SendClient {
            calls: calls.clone(),
        },
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("access-token"))),
        FakeRateLimiter::new(calls.clone(), Ok(())),
    );
    let sent = service
        .find_sent_message(Uuid::nil(), "attempt@example.com")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(sent.provider_message_id, "message-1");
    assert_eq!(
        *calls.lock().unwrap(),
        [
            Call::RateLimit(Uuid::nil(), super::ApiOperationKind::ListMessages),
            Call::Token(Uuid::nil(), TokenFreshness::Cached),
            Call::Repository("find_sent_message"),
        ]
    );
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
        message_id: None,
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
