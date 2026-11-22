//! deadsimple.email over its REST API (`https://api.deadsimple.email/v1`).
//!
//! The provisioning key creates and deletes mailboxes and mints one
//! inbox-scoped key per mailbox; every read and send uses that scoped key,
//! which the provider confines to its one inbox. Response shapes follow the
//! provider's OpenAPI document and its TypeScript SDK (`{ "data": ... }`
//! envelopes, `{ "error": { "code", "message" } }` failures).
//!
//! The adapter never pays: a `402 Payment Required` (the provider offers
//! per-call payment when a key is missing or invalid) is `NotConfigured`, and
//! no payment header is ever sent.

#[cfg(test)]
mod test;

use std::time::Duration;

use reqwest::{Method, RequestBuilder, Response, StatusCode};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use uuid::Uuid;

use crate::domain::models::{
    AgentMailboxId, CreateMailbox, MailMessage, MailboxKey, MessageDirection, MessageList,
    MessagePage, OutgoingMessage, ProviderGrantId, ProviderMailboxId, ProviderMessageId,
    ProvisionedMailbox, ReplyMessage, SentMessage, VendorMode,
};
use crate::domain::ports::{MailboxClient, MailboxProvisioner, ProviderError};

/// How long one provider call may take.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// What a mailbox's scoped key may do: read and send mail, nothing else.
const SCOPED_KEY_PERMISSIONS: [&str; 4] = [
    "messages.read",
    "messages.send",
    "threads.read",
    "attachments.read",
];

/// Largest attachment the provider guardrail lets through.
const GUARDRAIL_MAX_ATTACHMENT_MB: u32 = 10;

/// An id as one URL path segment, so no id can reach another route.
fn segment(id: &str) -> std::borrow::Cow<'_, str> {
    urlencoding::encode(id)
}

/// The owner tag on each provider mailbox, so a lost create can be found again.
fn owner_tag(mailbox: AgentMailboxId) -> String {
    format!("macro-agent-mailbox:{mailbox}")
}

/// The provisioning credential. Redacts `Debug`.
#[derive(Clone)]
pub struct ProvisioningKey(String);

impl ProvisioningKey {
    /// Wrap the configured key.
    #[must_use]
    pub fn new(value: String) -> Self {
        Self(value)
    }
}

impl std::fmt::Debug for ProvisioningKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ProvisioningKey(redacted)")
    }
}

/// The deadsimple.email adapter.
#[derive(Clone)]
pub struct DeadSimple {
    client: reqwest::Client,
    base_url: String,
    /// Absent when no key is configured: every provisioning call then
    /// answers `NotConfigured` without reaching the provider.
    provisioning_key: Option<ProvisioningKey>,
}

/// The HTTP client could not be built.
#[derive(Debug, thiserror::Error)]
#[error("could not build the deadsimple.email HTTP client")]
pub struct DeadSimpleClientError(#[from] reqwest::Error);

impl DeadSimple {
    /// An adapter for `base_url` (from `macro_service_urls::DeadSimpleApiUrl`).
    pub fn new(
        base_url: &str,
        provisioning_key: Option<ProvisioningKey>,
    ) -> Result<Self, DeadSimpleClientError> {
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()?;
        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_owned(),
            provisioning_key,
        })
    }

    /// Whether `base_url` is the provider's real API rather than a fake.
    #[must_use]
    pub fn vendor_mode(base_url: &str) -> VendorMode {
        let real = macro_service_urls::DeadSimpleApiUrl::PROD.trim_end_matches('/');
        if base_url.trim_end_matches('/') == real {
            VendorMode::Live
        } else {
            VendorMode::Fake
        }
    }

    fn request(&self, method: Method, path: &str, key: &str) -> RequestBuilder {
        let mut trace_headers = http::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut trace_headers);
        self.client
            .request(method, format!("{}{path}", self.base_url))
            .bearer_auth(key)
            .headers(trace_headers)
    }

    fn admin(&self, method: Method, path: &str) -> Result<RequestBuilder, ProviderError> {
        let key = self
            .provisioning_key
            .as_ref()
            .ok_or(ProviderError::NotConfigured)?;
        Ok(self.request(method, path, &key.0))
    }

    fn scoped(&self, method: Method, path: &str, key: &MailboxKey) -> RequestBuilder {
        self.request(method, path, key.expose())
    }
}

#[derive(Deserialize)]
struct Envelope<Data> {
    data: Data,
}

#[derive(Deserialize)]
struct ErrorEnvelope {
    error: Option<ErrorBody>,
}

#[derive(Deserialize)]
struct ErrorBody {
    code: Option<String>,
}

#[derive(Deserialize)]
struct Inbox {
    inbox_id: String,
    email: String,
    #[serde(default)]
    tags: Vec<String>,
}

impl From<Inbox> for ProvisionedMailbox {
    fn from(inbox: Inbox) -> Self {
        Self {
            id: ProviderMailboxId(inbox.inbox_id),
            address: inbox.email,
        }
    }
}

#[derive(Deserialize)]
struct InboxList {
    inboxes: Vec<Inbox>,
}

#[derive(Deserialize)]
struct ApiKeyList {
    api_keys: Vec<ListedApiKey>,
}

#[derive(Deserialize)]
struct ListedApiKey {
    key_id: String,
    #[serde(default)]
    inbox_ids: Vec<String>,
}

#[derive(Deserialize)]
struct ApiKey {
    key_id: String,
    key: Option<String>,
}

#[derive(Deserialize)]
struct Message {
    message_id: String,
    inbox_id: String,
    thread_id: Option<String>,
    direction: String,
    from_email: Option<String>,
    #[serde(default)]
    to: Vec<String>,
    #[serde(default)]
    cc: Vec<String>,
    #[serde(default)]
    subject: String,
    text_body: Option<String>,
    created_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl TryFrom<Message> for MailMessage {
    type Error = ProviderError;

    fn try_from(message: Message) -> Result<Self, Self::Error> {
        let direction = message
            .direction
            .parse::<MessageDirection>()
            .map_err(|_| ProviderError::Unavailable)?;
        Ok(Self {
            id: ProviderMessageId(message.message_id),
            mailbox: ProviderMailboxId(message.inbox_id),
            thread_id: message.thread_id,
            direction,
            from: message.from_email.unwrap_or_default(),
            to: message.to,
            cc: message.cc,
            subject: message.subject,
            text_body: message.text_body,
            created_at: message.created_at,
        })
    }
}

#[derive(Deserialize)]
struct ProviderMessageList {
    messages: Vec<Message>,
    cursor: Option<String>,
}

#[derive(Deserialize)]
struct SendResult {
    message_id: String,
    thread_id: Option<String>,
}

#[derive(Serialize)]
struct CreateInboxBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    local_part: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<&'a str>,
    tags: [String; 1],
}

#[derive(Serialize)]
struct GuardrailsBody {
    max_sends_per_hour: u32,
    max_attachment_size_mb: u32,
}

#[derive(Serialize)]
struct CreateApiKeyBody<'a> {
    name: String,
    permissions: [&'static str; 4],
    inbox_ids: [&'a str; 1],
}

#[derive(Serialize)]
struct SendBody<'a> {
    to: &'a [String],
    #[serde(skip_serializing_if = "<[String]>::is_empty")]
    cc: &'a [String],
    subject: &'a str,
    text_body: &'a str,
}

#[derive(Serialize)]
struct ReplyBody<'a> {
    text_body: &'a str,
}

/// Which call a failure came from, where the same status means different things.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Operation {
    CreateInbox,
    Send,
    Other,
}

/// Classify a failed response. `404` and `409` are left to the caller where
/// they are an outcome rather than a failure.
async fn failure(response: Response, operation: Operation) -> ProviderError {
    let status = response.status();
    let code = response
        .json::<ErrorEnvelope>()
        .await
        .ok()
        .and_then(|envelope| envelope.error)
        .and_then(|error| error.code)
        .unwrap_or_default();
    let error = match status {
        StatusCode::UNAUTHORIZED | StatusCode::PAYMENT_REQUIRED => ProviderError::NotConfigured,
        StatusCode::FORBIDDEN if code.contains("limit") || code.contains("quota") => {
            ProviderError::QuotaExceeded
        }
        StatusCode::FORBIDDEN => ProviderError::NotConfigured,
        StatusCode::NOT_FOUND => ProviderError::NotFound,
        // Only a conflict the provider names as the address is a taken
        // address. Any other (an idempotent create still in flight) is
        // retried under the same key: reading it as taken would make a
        // second, suffixed mailbox and orphan the first.
        StatusCode::CONFLICT if operation == Operation::CreateInbox && names_the_address(&code) => {
            ProviderError::AddressTaken
        }
        StatusCode::CONFLICT if operation == Operation::CreateInbox => ProviderError::Unavailable,
        // An idempotent request still in flight: retry under the same key.
        StatusCode::CONFLICT if operation == Operation::Send => ProviderError::Unavailable,
        StatusCode::TOO_MANY_REQUESTS if operation == Operation::Send => ProviderError::SendLimit,
        StatusCode::TOO_MANY_REQUESTS => ProviderError::Throttled,
        status if status.is_server_error() => ProviderError::Unavailable,
        _ => ProviderError::Rejected,
    };
    tracing::warn!(
        http.status = status.as_u16(),
        provider.error_code = code,
        "deadsimple.email refused a request"
    );
    error
}

/// Whether a create conflict's error code is about the address itself.
fn names_the_address(code: &str) -> bool {
    let code = code.to_ascii_lowercase();
    !code.contains("idempoten")
        && [
            "address",
            "email",
            "local_part",
            "taken",
            "exists",
            "unavailable",
        ]
        .iter()
        .any(|word| code.contains(word))
}

async fn send_request(request: RequestBuilder) -> Result<Response, ProviderError> {
    request.send().await.map_err(|error| {
        tracing::warn!(error = %error, "deadsimple.email unreachable");
        ProviderError::Unavailable
    })
}

/// Send and decode `{ "data": ... }`, classifying failures.
async fn data<Data: DeserializeOwned>(
    request: RequestBuilder,
    operation: Operation,
) -> Result<Data, ProviderError> {
    let response = send_request(request).await?;
    if !response.status().is_success() {
        return Err(failure(response, operation).await);
    }
    let envelope = response.json::<Envelope<Data>>().await.map_err(|error| {
        tracing::warn!(error = %error, "deadsimple.email response did not decode");
        ProviderError::Unavailable
    })?;
    Ok(envelope.data)
}

/// Send a request whose success has no body; `404` counts as already done.
async fn idempotent_delete(request: RequestBuilder) -> Result<(), ProviderError> {
    let response = send_request(request).await?;
    match response.status() {
        status if status.is_success() => Ok(()),
        StatusCode::NOT_FOUND => Ok(()),
        _ => Err(failure(response, Operation::Other).await),
    }
}

impl MailboxProvisioner for DeadSimple {
    #[tracing::instrument(name = "agent_mailbox.deadsimple.create_inbox", skip_all, fields(agent_mailbox.id = %request.owner_tag), err)]
    async fn create_mailbox(
        &self,
        request: &CreateMailbox,
    ) -> Result<ProvisionedMailbox, ProviderError> {
        let body = CreateInboxBody {
            local_part: request
                .local_part
                .as_ref()
                .map(|local_part| local_part.as_str()),
            display_name: request.display_name.as_deref(),
            tags: [owner_tag(request.owner_tag)],
        };
        let inbox: Inbox = data(
            self.admin(Method::POST, "/v1/inboxes")?
                .header("Idempotency-Key", request.idempotency_key.to_string())
                .json(&body),
            Operation::CreateInbox,
        )
        .await?;

        Ok(inbox.into())
    }

    #[tracing::instrument(name = "agent_mailbox.deadsimple.set_guardrails", skip_all, err)]
    async fn apply_guardrails(
        &self,
        mailbox: &ProviderMailboxId,
        max_sends_per_hour: u32,
    ) -> Result<(), ProviderError> {
        let guardrails = GuardrailsBody {
            max_sends_per_hour,
            max_attachment_size_mb: GUARDRAIL_MAX_ATTACHMENT_MB,
        };
        let path = format!("/v1/inboxes/{}/guardrails", segment(&mailbox.0));
        let response = send_request(self.admin(Method::PUT, &path)?.json(&guardrails)).await?;
        if !response.status().is_success() {
            return Err(failure(response, Operation::Other).await);
        }
        Ok(())
    }

    #[tracing::instrument(name = "agent_mailbox.deadsimple.find_inbox", skip_all, fields(agent_mailbox.id = %owner_tag), err)]
    async fn find_mailbox(
        &self,
        owner_tag: AgentMailboxId,
    ) -> Result<Option<ProvisionedMailbox>, ProviderError> {
        let tag = self::owner_tag(owner_tag);
        let list: InboxList = data(
            self.admin(Method::GET, "/v1/inboxes")?
                .query(&[("tag", tag.as_str()), ("limit", "100")]),
            Operation::Other,
        )
        .await?;

        // The tag filter is the provider's; the match is ours. An inbox that
        // doesn't carry exactly this owner's tag is never taken for it, and
        // two that do are refused rather than guessed between.
        let listed = list.inboxes.len();
        let mut owned = list
            .inboxes
            .into_iter()
            .filter(|inbox| inbox.tags.iter().any(|candidate| candidate == &tag));
        let first = owned.next();
        if first.is_none() && listed > 0 {
            // The provider listed inboxes but none carries the tag: its tag
            // filter or field isn't what this adapter expects, and a lost
            // create can't be found.
            tracing::warn!(agent_mailbox.id = %owner_tag, listed, "provider tag listing matched no inbox");
        }
        if owned.next().is_some() {
            tracing::error!(agent_mailbox.id = %owner_tag, "two provider inboxes carry one mailbox's owner tag");
            return Err(ProviderError::Unavailable);
        }
        Ok(first.map(ProvisionedMailbox::from))
    }

    #[tracing::instrument(name = "agent_mailbox.deadsimple.create_scoped_key", skip_all, err)]
    async fn grant_access(
        &self,
        mailbox: &ProviderMailboxId,
        idempotency_key: Uuid,
    ) -> Result<(ProviderGrantId, MailboxKey), ProviderError> {
        let body = CreateApiKeyBody {
            name: format!("macro-agent-mailbox-{idempotency_key}"),
            permissions: SCOPED_KEY_PERMISSIONS,
            inbox_ids: [mailbox.0.as_str()],
        };
        let created: ApiKey = data(
            self.admin(Method::POST, "/v1/api-keys")?
                .header("Idempotency-Key", idempotency_key.to_string())
                .json(&body),
            Operation::Other,
        )
        .await?;

        // The secret is only in the creating response (and its idempotent replays).
        let key = created.key.ok_or(ProviderError::Unavailable)?;
        Ok((ProviderGrantId(created.key_id), MailboxKey::new(key)))
    }

    #[tracing::instrument(name = "agent_mailbox.deadsimple.revoke_scoped_key", skip_all, err)]
    async fn revoke_access(&self, grant: &ProviderGrantId) -> Result<(), ProviderError> {
        idempotent_delete(self.admin(
            Method::DELETE,
            &format!("/v1/api-keys/{}", segment(&grant.0)),
        )?)
        .await
    }

    #[tracing::instrument(name = "agent_mailbox.deadsimple.revoke_scoped_keys", skip_all, err)]
    async fn revoke_all_access(
        &self,
        mailbox: &ProviderMailboxId,
        already_revoked: Option<&ProviderGrantId>,
    ) -> Result<(), ProviderError> {
        let keys: ApiKeyList =
            data(self.admin(Method::GET, "/v1/api-keys")?, Operation::Other).await?;
        // Only keys scoped to exactly this mailbox: never an account-wide key.
        let scoped = keys
            .api_keys
            .into_iter()
            .filter(|key| key.inbox_ids.as_slice() == std::slice::from_ref(&mailbox.0))
            .filter(|key| already_revoked.is_none_or(|revoked| revoked.0 != key.key_id));
        for key in scoped {
            self.revoke_access(&ProviderGrantId(key.key_id)).await?;
        }
        Ok(())
    }

    #[tracing::instrument(name = "agent_mailbox.deadsimple.delete_inbox", skip_all, err)]
    async fn delete_mailbox(&self, mailbox: &ProviderMailboxId) -> Result<(), ProviderError> {
        idempotent_delete(self.admin(
            Method::DELETE,
            &format!("/v1/inboxes/{}", segment(&mailbox.0)),
        )?)
        .await
    }
}

impl MailboxClient for DeadSimple {
    #[tracing::instrument(name = "agent_mailbox.deadsimple.list_messages", skip_all, err)]
    async fn list_messages(
        &self,
        mailbox: &ProviderMailboxId,
        key: &MailboxKey,
        page: &MessagePage,
    ) -> Result<MessageList, ProviderError> {
        let limit = page.limit.unwrap_or(20).to_string();
        let mut query = vec![("limit", limit.as_str())];
        if let Some(cursor) = &page.cursor {
            query.push(("cursor", cursor.as_str()));
        }
        let list: ProviderMessageList = data(
            self.scoped(
                Method::GET,
                &format!("/v1/inboxes/{}/messages", segment(&mailbox.0)),
                key,
            )
            .query(&query),
            Operation::Other,
        )
        .await?;
        let messages = list
            .messages
            .into_iter()
            .map(MailMessage::try_from)
            .collect::<Result<_, _>>()?;
        Ok(MessageList {
            messages,
            next_cursor: list.cursor,
        })
    }

    #[tracing::instrument(name = "agent_mailbox.deadsimple.read_message", skip_all, err)]
    async fn read_message(
        &self,
        mailbox: &ProviderMailboxId,
        key: &MailboxKey,
        message: &ProviderMessageId,
    ) -> Result<MailMessage, ProviderError> {
        let path = format!(
            "/v1/inboxes/{}/messages/{}",
            segment(&mailbox.0),
            segment(&message.0)
        );
        let found: Message = data(self.scoped(Method::GET, &path, key), Operation::Other).await?;
        found.try_into()
    }

    #[tracing::instrument(name = "agent_mailbox.deadsimple.send", skip_all, err)]
    async fn send(
        &self,
        mailbox: &ProviderMailboxId,
        key: &MailboxKey,
        message: &OutgoingMessage,
        idempotency_key: Uuid,
    ) -> Result<SentMessage, ProviderError> {
        let body = SendBody {
            to: &message.to,
            cc: &message.cc,
            subject: &message.subject,
            text_body: &message.text_body,
        };
        let sent: SendResult = data(
            self.scoped(
                Method::POST,
                &format!("/v1/inboxes/{}/messages", segment(&mailbox.0)),
                key,
            )
            .header("Idempotency-Key", idempotency_key.to_string())
            .json(&body),
            Operation::Send,
        )
        .await?;
        Ok(SentMessage {
            id: ProviderMessageId(sent.message_id),
            thread_id: sent.thread_id,
        })
    }

    #[tracing::instrument(name = "agent_mailbox.deadsimple.reply", skip_all, err)]
    async fn reply(
        &self,
        mailbox: &ProviderMailboxId,
        key: &MailboxKey,
        message: &ProviderMessageId,
        reply: &ReplyMessage,
        idempotency_key: Uuid,
    ) -> Result<SentMessage, ProviderError> {
        let path = format!(
            "/v1/inboxes/{}/messages/{}/reply",
            segment(&mailbox.0),
            segment(&message.0)
        );
        let sent: SendResult = data(
            self.scoped(Method::POST, &path, key)
                .header("Idempotency-Key", idempotency_key.to_string())
                .json(&ReplyBody {
                    text_body: &reply.text_body,
                }),
            Operation::Send,
        )
        .await?;
        Ok(SentMessage {
            id: ProviderMessageId(sent.message_id),
            thread_id: sent.thread_id,
        })
    }
}
