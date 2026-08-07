use std::sync::{Arc, Mutex};

use models_email::email::service::label::Label;
use models_email::email::service::message::Message;
use models_email::service::contact::{Contact, ContactList};
use uuid::Uuid;

use super::super::models::{
    AccessToken, ApiOperationKind, ChangeBatch, EmailApiError, ProviderSubscription,
    RateLimitRefusal, SendRequest, SentIds, SyncCursor, ThreadListPage, TokenError, TokenFreshness,
};
use super::super::ports::{
    MailboxAttachmentClient, MailboxBlocklistClient, MailboxContactsClient, MailboxLabelClient,
    MailboxMessageClient, MailboxSendClient, MailboxSubscriptionClient, MailboxSyncClient,
    ProviderRateLimiter, ProviderTokenSource,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Call {
    Token(Uuid, TokenFreshness),
    HealthNeutralToken(Uuid, TokenFreshness),
    RateLimit(Uuid, ApiOperationKind),
    Repository(&'static str),
}

pub(super) type CallLog = Arc<Mutex<Vec<Call>>>;

pub(super) fn call_log() -> CallLog {
    Arc::new(Mutex::new(Vec::new()))
}

#[derive(Clone)]
pub(super) struct FakeTokenSource {
    calls: CallLog,
    result: Result<AccessToken, TokenError>,
}

impl FakeTokenSource {
    pub(super) fn new(calls: CallLog, result: Result<AccessToken, TokenError>) -> Self {
        Self { calls, result }
    }
}

impl ProviderTokenSource for FakeTokenSource {
    async fn get_access_token(
        &self,
        link_id: Uuid,
        freshness: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Token(link_id, freshness));
        self.result.clone()
    }

    async fn get_access_token_for_link(
        &self,
        link: &models_email::service::link::Link,
        freshness: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Token(link.id, freshness));
        self.result.clone()
    }

    async fn get_access_token_health_neutral(
        &self,
        link: &models_email::service::link::Link,
        freshness: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::HealthNeutralToken(link.id, freshness));
        self.result.clone()
    }
}

#[derive(Clone)]
pub(super) struct FakeRateLimiter {
    calls: CallLog,
    result: Result<(), RateLimitRefusal>,
}

impl FakeRateLimiter {
    pub(super) fn new(calls: CallLog, result: Result<(), RateLimitRefusal>) -> Self {
        Self { calls, result }
    }
}

impl ProviderRateLimiter for FakeRateLimiter {
    async fn check_rate_limit(
        &self,
        link_id: Uuid,
        operation: ApiOperationKind,
    ) -> Result<(), RateLimitRefusal> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::RateLimit(link_id, operation));
        self.result.clone()
    }
}

#[derive(Clone)]
pub(super) struct FakeRepository {
    calls: CallLog,
}

impl FakeRepository {
    pub(super) fn new(calls: CallLog) -> Self {
        Self { calls }
    }

    fn unavailable<T>(&self, method: &'static str) -> Result<T, EmailApiError> {
        self.calls.lock().unwrap().push(Call::Repository(method));
        Err(EmailApiError::Permanent {
            message: "fake repository response is not configured".to_string(),
        })
    }
}

impl MailboxSyncClient for FakeRepository {
    async fn get_thread_count(&self, _: &AccessToken) -> Result<u64, EmailApiError> {
        self.unavailable("get_thread_count")
    }

    async fn list_changes(
        &self,
        _: &AccessToken,
        _: &SyncCursor,
    ) -> Result<ChangeBatch, EmailApiError> {
        self.unavailable("list_changes")
    }
}

impl MailboxSubscriptionClient for FakeRepository {
    async fn subscribe(&self, _: &AccessToken) -> Result<ProviderSubscription, EmailApiError> {
        self.unavailable("subscribe")
    }

    async fn unsubscribe(&self, _: &AccessToken) -> Result<(), EmailApiError> {
        self.unavailable("unsubscribe")
    }
}

impl MailboxMessageClient for FakeRepository {
    async fn get_message(
        &self,
        _: &AccessToken,
        _: Uuid,
        _: &str,
    ) -> Result<Option<crate::domain::models::MessageWithCalendarParts>, EmailApiError> {
        self.unavailable("get_message")
    }

    async fn get_message_label_ids(
        &self,
        _: &AccessToken,
        _: &str,
    ) -> Result<Option<Vec<String>>, EmailApiError> {
        self.unavailable("get_message_label_ids")
    }

    async fn list_messages(
        &self,
        _: &AccessToken,
        _: u32,
        _: &[&str],
    ) -> Result<Vec<String>, EmailApiError> {
        self.unavailable("list_messages")
    }

    async fn get_message_ids_for_thread(
        &self,
        _: &AccessToken,
        _: &str,
    ) -> Result<Vec<String>, EmailApiError> {
        self.unavailable("get_message_ids_for_thread")
    }

    async fn get_thread(
        &self,
        _: &AccessToken,
        _: Uuid,
        _: &str,
    ) -> Result<Vec<Message>, EmailApiError> {
        self.unavailable("get_thread")
    }

    async fn list_threads(
        &self,
        _: &AccessToken,
        _: u32,
        _: Option<&str>,
        _: &[&str],
    ) -> Result<ThreadListPage, EmailApiError> {
        self.unavailable("list_threads")
    }

    async fn modify_message_labels(
        &self,
        _: &AccessToken,
        _: &str,
        _: &[String],
        _: &[String],
    ) -> Result<(), EmailApiError> {
        self.unavailable("modify_message_labels")
    }
}

impl MailboxSendClient for FakeRepository {
    async fn send_message(
        &self,
        _: &AccessToken,
        _: &SendRequest,
        _: Option<&str>,
    ) -> Result<SentIds, EmailApiError> {
        self.unavailable("send_message")
    }
}

impl MailboxLabelClient for FakeRepository {
    async fn list_labels(&self, _: &AccessToken, _: Uuid) -> Result<Vec<Label>, EmailApiError> {
        self.unavailable("list_labels")
    }

    async fn create_label(
        &self,
        _: &AccessToken,
        _: Uuid,
        _: &str,
    ) -> Result<Label, EmailApiError> {
        self.unavailable("create_label")
    }

    async fn delete_label(&self, _: &AccessToken, _: &str) -> Result<(), EmailApiError> {
        self.unavailable("delete_label")
    }
}

impl MailboxAttachmentClient for FakeRepository {
    async fn get_attachment(
        &self,
        _: &AccessToken,
        _: &str,
        _: &str,
    ) -> Result<Vec<u8>, EmailApiError> {
        self.unavailable("get_attachment")
    }
}

impl MailboxContactsClient for FakeRepository {
    async fn get_self_contact(&self, _: &AccessToken, _: Uuid) -> Result<Contact, EmailApiError> {
        self.unavailable("get_self_contact")
    }

    async fn list_contacts(
        &self,
        _: &AccessToken,
        _: Uuid,
        _: Option<&str>,
    ) -> Result<ContactList, EmailApiError> {
        self.unavailable("list_contacts")
    }

    async fn list_other_contacts(
        &self,
        _: &AccessToken,
        _: Uuid,
        _: Option<&str>,
    ) -> Result<ContactList, EmailApiError> {
        self.unavailable("list_other_contacts")
    }
}

impl MailboxBlocklistClient for FakeRepository {
    async fn block_sender(&self, _: &AccessToken, _: &str) -> Result<(), EmailApiError> {
        self.unavailable("block_sender")
    }

    async fn unblock_sender(&self, _: &AccessToken, _: &str) -> Result<(), EmailApiError> {
        self.unavailable("unblock_sender")
    }

    async fn list_blocked_senders(&self, _: &AccessToken) -> Result<Vec<String>, EmailApiError> {
        self.unavailable("list_blocked_senders")
    }
}
