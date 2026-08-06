use std::sync::{Arc, Mutex};

use models_email::email::service::message::Message;
use uuid::Uuid;

use super::super::test_support::{Call, FakeRateLimiter, FakeTokenSource, block_on, call_log};
use super::*;
use crate::domain::models::{AccessToken, TokenFreshness};

#[derive(Debug, Clone, PartialEq, Eq)]
enum MessageCall {
    Message(Uuid, String),
    MessageLabels(String),
    Messages(u32, Vec<String>),
    MessageIdsForThread(String),
    Thread(Uuid, String),
    Threads(u32, Option<String>, Vec<String>),
}

#[derive(Clone, Default)]
struct MessageClient {
    call: Arc<Mutex<Option<MessageCall>>>,
}

impl MessageClient {
    fn record(&self, access_token: &AccessToken, call: MessageCall) -> EmailApiError {
        assert_eq!(access_token.expose_secret(), "token");
        *self.call.lock().unwrap() = Some(call);
        expected_error()
    }
}

impl MailboxMessageClient for MessageClient {
    async fn get_message(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        message_id: &str,
    ) -> Result<Option<Message>, EmailApiError> {
        Err(self.record(
            access_token,
            MessageCall::Message(link_id, message_id.to_string()),
        ))
    }

    async fn get_message_label_ids(
        &self,
        access_token: &AccessToken,
        message_id: &str,
    ) -> Result<Option<Vec<String>>, EmailApiError> {
        Err(self.record(
            access_token,
            MessageCall::MessageLabels(message_id.to_string()),
        ))
    }

    async fn list_messages(
        &self,
        access_token: &AccessToken,
        limit: u32,
        label_ids: &[&str],
    ) -> Result<Vec<String>, EmailApiError> {
        Err(self.record(
            access_token,
            MessageCall::Messages(
                limit,
                label_ids.iter().map(|label| (*label).to_string()).collect(),
            ),
        ))
    }

    async fn get_message_ids_for_thread(
        &self,
        access_token: &AccessToken,
        thread_id: &str,
    ) -> Result<Vec<String>, EmailApiError> {
        Err(self.record(
            access_token,
            MessageCall::MessageIdsForThread(thread_id.to_string()),
        ))
    }

    async fn get_thread(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        thread_id: &str,
    ) -> Result<Vec<Message>, EmailApiError> {
        Err(self.record(
            access_token,
            MessageCall::Thread(link_id, thread_id.to_string()),
        ))
    }

    async fn list_threads(
        &self,
        access_token: &AccessToken,
        limit: u32,
        page_token: Option<&str>,
        label_ids: &[&str],
    ) -> Result<ThreadListPage, EmailApiError> {
        Err(self.record(
            access_token,
            MessageCall::Threads(
                limit,
                page_token.map(str::to_string),
                label_ids.iter().map(|label| (*label).to_string()).collect(),
            ),
        ))
    }

    async fn modify_message_labels(
        &self,
        _: &AccessToken,
        _: &str,
        _: &[String],
        _: &[String],
    ) -> Result<(), EmailApiError> {
        unreachable!()
    }
}

fn expected_error() -> EmailApiError {
    EmailApiError::Permanent {
        message: "provider error".to_string(),
    }
}

fn assert_call<F, E>(operation: ApiOperationKind, expected_repository_call: E, invoke: F)
where
    E: FnOnce(Uuid) -> MessageCall,
    F: FnOnce(
        &EmailApiClientServiceImpl<MessageClient, FakeTokenSource, FakeRateLimiter>,
        Uuid,
    ) -> Result<(), EmailApiError>,
{
    let calls = call_log();
    let repository = MessageClient::default();
    let repository_call = repository.call.clone();
    let link_id = Uuid::new_v4();
    let service = EmailApiClientServiceImpl::new(
        repository,
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("token"))),
        FakeRateLimiter::new(calls.clone(), Ok(())),
    );

    assert_eq!(invoke(&service, link_id), Err(expected_error()));
    assert_eq!(
        *repository_call.lock().unwrap(),
        Some(expected_repository_call(link_id))
    );
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::Token(link_id, TokenFreshness::Cached),
            Call::RateLimit(link_id, operation),
        ]
    );
}

#[test]
fn message_reads_use_correct_operation_kinds_and_forward_parameters() {
    assert_call(
        ApiOperationKind::GetMessage,
        |link_id| MessageCall::Message(link_id, "message".into()),
        |service, link_id| block_on(service.get_message(link_id, "message")).map(|_| ()),
    );
    assert_call(
        ApiOperationKind::GetMessage,
        |_| MessageCall::MessageLabels("message".into()),
        |service, link_id| block_on(service.get_message_label_ids(link_id, "message")).map(|_| ()),
    );
    assert_call(
        ApiOperationKind::ListMessages,
        |_| MessageCall::Messages(25, vec!["inbox".into(), "unread".into()]),
        |service, link_id| {
            block_on(service.list_messages(link_id, 25, &["inbox", "unread"])).map(|_| ())
        },
    );
    assert_call(
        ApiOperationKind::GetThread,
        |_| MessageCall::MessageIdsForThread("thread".into()),
        |service, link_id| {
            block_on(service.get_message_ids_for_thread(link_id, "thread")).map(|_| ())
        },
    );
    assert_call(
        ApiOperationKind::GetThread,
        |link_id| MessageCall::Thread(link_id, "thread".into()),
        |service, link_id| block_on(service.get_thread(link_id, "thread")).map(|_| ()),
    );
    assert_call(
        ApiOperationKind::ListThreads,
        |_| {
            MessageCall::Threads(
                50,
                Some("next-page".into()),
                vec!["inbox".into(), "starred".into()],
            )
        },
        |service, link_id| {
            block_on(service.list_threads(link_id, 50, Some("next-page"), &["inbox", "starred"]))
                .map(|_| ())
        },
    );
}
