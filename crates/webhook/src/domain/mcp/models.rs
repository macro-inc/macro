//! MCP Events webhook subscription models.

#[cfg(test)]
#[path = "models_test.rs"]
mod test;

use super::filter::McpEventFilter;
use crate::domain::models::NormalizedWebhookEvent;
use chrono::{DateTime, Duration, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use uuid::Uuid;
use webhook_signature::standard::SigningSecret;

/// Prefix of a derived subscription id.
const SUBSCRIPTION_ID_PREFIX: &str = "sub_";
/// Bytes of the key digest kept in a subscription id (128 bits).
const SUBSCRIPTION_ID_DIGEST_BYTES: usize = 16;
/// Lifetime granted when the client suggests none, or asks for no expiry.
pub const DEFAULT_TTL: Duration = Duration::hours(1);
/// Longest lifetime granted.
pub const MAX_TTL: Duration = Duration::hours(24);
/// Shortest lifetime granted; shorter suggestions are clamped up to it.
pub const MIN_TTL: Duration = Duration::minutes(1);
/// Most live subscriptions one user may hold.
pub const MAX_SUBSCRIPTIONS_PER_USER: u32 = 50;
/// Largest subscription arguments, in bytes of JSON.
pub const MAX_ARGUMENTS_BYTES: usize = 4 * 1024;
/// Largest compiled filter, in bytes of JSON. Matching reads every
/// candidate's filter, so this bounds the work per event.
pub const MAX_FILTER_BYTES: usize = 4 * 1024;
/// Queue contract version of [`McpEventQueueMessage`].
pub const MCP_EVENT_QUEUE_MESSAGE_VERSION: u8 = 1;
/// Prefix of a delivery's `webhook-id`.
const MESSAGE_ID_PREFIX: &str = "msg_";
/// How long deliveries stay signed with a subscription's previous secret
/// after a refresh replaces it, so a receiver that still holds the old one
/// accepts them.
pub const SECRET_ROTATION_WINDOW: Duration = Duration::minutes(10);
/// Largest delivery body ChatGPT accepts; a larger one is never sent, to any
/// endpoint (a receiver answers 413, which is not retried either).
pub const MAX_DELIVERY_BYTES: usize = 256 * 1024;

/// Whose conventions a subscription's deliveries follow.
#[derive(
    Debug,
    Clone,
    Copy,
    Default,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    strum::Display,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub enum McpDeliveryProfile {
    /// MCP Events as specified: `webhook-id` names the delivered message and
    /// `eventId` the upstream event, and `data` is the broker envelope.
    #[default]
    Mcp,
    /// ChatGPT's MCP Events integration, which follows an earlier draft:
    /// `webhook-id` equals the body's `eventId`, so `eventId` is the
    /// delivery's own id (the event's is in `data.event_id`), and `data`
    /// names no person by user id or email (see [`without_people`]), as
    /// ChatGPT's tools never do.
    Chatgpt,
}

impl McpDeliveryProfile {
    /// Whether this is the default, which the subscribe body leaves out.
    #[must_use]
    pub fn is_default(&self) -> bool {
        *self == Self::Mcp
    }
}

/// What `data` says in place of the subscriber's own user id or email under
/// [`McpDeliveryProfile::Chatgpt`]; subscription arguments take the same word.
pub const SUBSCRIBER_PLACEHOLDER: &str = "me";
/// What `data` says in place of anyone else's.
pub const PERSON_PLACEHOLDER: &str = "someone";

/// `value` with every user id and email address in its strings replaced: the
/// subscriber's own by [`SUBSCRIBER_PLACEHOLDER`], anyone else's by
/// [`PERSON_PLACEHOLDER`]. Object keys are kept.
#[must_use]
pub fn without_people(
    value: &serde_json::Value,
    subscriber: &MacroUserIdStr<'_>,
) -> serde_json::Value {
    let subscriber_id: &str = subscriber.as_ref();
    let subscriber_email = subscriber_id
        .strip_prefix("macro|")
        .unwrap_or(subscriber_id);
    // `macro|<email>` or a bare email address, anywhere in a string: the
    // pattern ChatGPT's tools hide people by (`mcp-chatgpt-worker`'s person
    // tokens).
    let hide = |text: &str| -> String {
        lazy_regex::regex_replace_all!(
            r"(macro\|)?([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})",
            text,
            |_, _, email: &str| if email.eq_ignore_ascii_case(subscriber_email) {
                SUBSCRIBER_PLACEHOLDER
            } else {
                PERSON_PLACEHOLDER
            }
        )
        .into_owned()
    };
    match value {
        serde_json::Value::String(text) => serde_json::Value::String(hide(text)),
        serde_json::Value::Array(items) => serde_json::Value::Array(
            items
                .iter()
                .map(|item| without_people(item, subscriber))
                .collect(),
        ),
        serde_json::Value::Object(fields) => serde_json::Value::Object(
            fields
                .iter()
                .map(|(key, field)| (key.clone(), without_people(field, subscriber)))
                .collect(),
        ),
        serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::Number(_) => {
            value.clone()
        }
    }
}

/// The server-derived handle of a webhook subscription: `sub_` and 32 hex
/// digits of a SHA-256 over the subscription key. A routing handle, not a
/// capability.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct McpSubscriptionId(String);

impl McpSubscriptionId {
    /// Derive the id of `(principal, url, name, arguments)`, comparing
    /// `arguments` by canonical JSON (object keys sorted, no whitespace).
    #[must_use]
    pub fn derive(key: &McpSubscriptionKey) -> Self {
        let mut canonical = String::new();
        write_canonical_json(&key.arguments, &mut canonical);
        // A JSON array of strings is an unambiguous serialization of the key.
        let serialized = serde_json::Value::Array(vec![
            key.user_id.as_ref().into(),
            key.endpoint_url.as_str().into(),
            key.event_type.as_str().into(),
            canonical.into(),
        ])
        .to_string();
        let digest = Sha256::digest(serialized.as_bytes());
        let truncated = digest.get(..SUBSCRIPTION_ID_DIGEST_BYTES).unwrap_or(&[]);
        Self(format!(
            "{SUBSCRIPTION_ID_PREFIX}{}",
            hex::encode(truncated)
        ))
    }

    /// Wrap an id read back from storage.
    #[must_use]
    pub fn from_stored(value: String) -> Self {
        Self(value)
    }

    /// The id as text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for McpSubscriptionId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// What identifies one webhook subscription. Every part is immutable for its
/// lifetime: a different value addresses a different subscription.
#[derive(Debug, Clone, PartialEq)]
pub struct McpSubscriptionKey {
    /// The subscriber.
    pub user_id: MacroUserIdStr<'static>,
    /// Callback URL, exactly as the client sent it.
    pub endpoint_url: String,
    /// MCP event type name.
    pub event_type: String,
    /// Subscription arguments.
    pub arguments: serde_json::Value,
}

impl McpSubscriptionKey {
    /// The derived subscription id.
    #[must_use]
    pub fn id(&self) -> McpSubscriptionId {
        McpSubscriptionId::derive(self)
    }
}

fn write_canonical_json(value: &serde_json::Value, out: &mut String) {
    match value {
        serde_json::Value::Object(map) => {
            let mut entries: Vec<_> = map.iter().collect();
            entries.sort_unstable_by(|left, right| left.0.cmp(right.0));
            out.push('{');
            for (index, (key, value)) in entries.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::Value::String(key.clone()).to_string());
                out.push(':');
                write_canonical_json(value, out);
            }
            out.push('}');
        }
        serde_json::Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_canonical_json(item, out);
            }
            out.push(']');
        }
        scalar => out.push_str(&scalar.to_string()),
    }
}

/// The lifetime a client suggests for a subscription.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub enum McpTtlRequest {
    /// No suggestion (`ttlMs` absent): the server default.
    Default,
    /// `ttlMs: null`: no expiry, which Macro does not grant; a finite
    /// lifetime is granted instead.
    NoExpiry,
    /// A suggested lifetime in milliseconds.
    Millis {
        /// Milliseconds.
        value: u64,
    },
}

impl McpTtlRequest {
    /// When a subscription made at `now` expires: the suggestion, clamped to
    /// [`MIN_TTL`]..=[`MAX_TTL`], else [`DEFAULT_TTL`].
    #[must_use]
    pub fn grant(self, now: DateTime<Utc>) -> DateTime<Utc> {
        let ttl = match self {
            Self::Default | Self::NoExpiry => DEFAULT_TTL,
            Self::Millis { value } => i64::try_from(value)
                .ok()
                .and_then(Duration::try_milliseconds)
                .unwrap_or(MAX_TTL)
                .clamp(MIN_TTL, MAX_TTL),
        };
        now + ttl
    }
}

/// A subscriber's signing secret as KMS ciphertext, bound to the subscriber.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct McpSecretCiphertext {
    /// KMS ciphertext blob, base64.
    #[cfg_attr(feature = "inbound", schema(value_type = String, format = Byte))]
    #[serde(with = "base64_bytes")]
    pub ciphertext: Vec<u8>,
    /// The KMS key that encrypted it.
    pub kms_key_id: String,
    /// The encryption scheme.
    pub encryption_version: i16,
}

mod base64_bytes {
    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD;
    use serde::{Deserialize as _, Deserializer, Serializer};

    pub(super) fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&STANDARD.encode(bytes))
    }

    pub(super) fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<u8>, D::Error> {
        let text = String::deserialize(deserializer)?;
        STANDARD.decode(text).map_err(serde::de::Error::custom)
    }
}

/// One stored webhook subscription.
#[derive(Debug, Clone, PartialEq)]
pub struct McpEventSubscription {
    /// Row id, used by queued deliveries.
    pub id: Uuid,
    /// The subscriber.
    pub user_id: MacroUserIdStr<'static>,
    /// Derived MCP subscription id.
    pub subscription_id: McpSubscriptionId,
    /// MCP event type name.
    pub event_type: String,
    /// Subscription arguments.
    pub arguments: serde_json::Value,
    /// The compiled filter delivery evaluates.
    pub filter: McpEventFilter,
    /// Callback URL.
    pub endpoint_url: String,
    /// The signing secret, encrypted.
    pub secret: McpSecretCiphertext,
    /// The secret a refresh replaced, while deliveries are still signed with
    /// it too.
    pub previous_secret: Option<McpPreviousSecret>,
    /// Whose conventions its deliveries follow.
    pub profile: McpDeliveryProfile,
    /// When the subscription lapses unless refreshed.
    pub expires_at: DateTime<Utc>,
}

impl McpEventSubscription {
    /// Whether it is live at `now`.
    #[must_use]
    pub fn is_live(&self, now: DateTime<Utc>) -> bool {
        self.expires_at > now
    }

    /// The previous secret, if deliveries at `now` are still signed with it.
    #[must_use]
    pub fn signing_previous_secret(&self, now: DateTime<Utc>) -> Option<&McpSecretCiphertext> {
        self.previous_secret
            .as_ref()
            .filter(|previous| previous.expires_at > now)
            .map(|previous| &previous.secret)
    }
}

/// A signing secret a refresh replaced, kept for [`SECRET_ROTATION_WINDOW`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpPreviousSecret {
    /// The replaced secret, encrypted.
    pub secret: McpSecretCiphertext,
    /// When deliveries stop signing with it.
    pub expires_at: DateTime<Utc>,
}

/// A subscription to create or refresh: the body of the internal subscribe
/// call the MCP server makes for the acting user.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct McpSubscribeRequest {
    /// What identifies the subscription; the subscriber comes from the caller.
    pub event_type: String,
    /// Subscription arguments.
    #[cfg_attr(feature = "inbound", schema(value_type = Object))]
    pub arguments: serde_json::Value,
    /// Callback URL.
    pub endpoint_url: String,
    /// The filter delivery evaluates. The caller derives it from the
    /// arguments, so a refresh sends the same one.
    #[cfg_attr(feature = "inbound", schema(value_type = Object))]
    pub filter: McpEventFilter,
    /// The new `whsec_` signing secret in plaintext, to sign the endpoint
    /// challenge.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    #[serde(with = "whsec_secret")]
    pub secret: SigningSecret,
    /// The same secret encrypted for storage.
    pub secret_ciphertext: McpSecretCiphertext,
    /// The suggested lifetime.
    pub ttl: McpTtlRequest,
    /// Whose conventions deliveries follow; absent means MCP's. A refresh
    /// sets it again.
    #[serde(default, skip_serializing_if = "McpDeliveryProfile::is_default")]
    pub profile: McpDeliveryProfile,
}

mod whsec_secret {
    use serde::{Deserialize as _, Deserializer, Serializer};
    use webhook_signature::standard::SigningSecret;

    pub(super) fn serialize<S: Serializer>(
        secret: &SigningSecret,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&secret.expose())
    }

    pub(super) fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<SigningSecret, D::Error> {
        let text = zeroize::Zeroizing::new(String::deserialize(deserializer)?);
        SigningSecret::parse(&text).map_err(serde::de::Error::custom)
    }
}

/// What names a subscription to remove: the body of the internal
/// unsubscribe call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct McpUnsubscribeRequest {
    /// MCP event type name.
    pub event_type: String,
    /// Subscription arguments.
    #[cfg_attr(feature = "inbound", schema(value_type = Object))]
    pub arguments: serde_json::Value,
    /// Callback URL.
    pub endpoint_url: String,
}

impl McpUnsubscribeRequest {
    /// The key of `user_id`'s subscription.
    #[must_use]
    pub fn into_key(self, user_id: MacroUserIdStr<'static>) -> McpSubscriptionKey {
        McpSubscriptionKey {
            user_id,
            endpoint_url: self.endpoint_url,
            event_type: self.event_type,
            arguments: self.arguments,
        }
    }
}

/// Why an internal subscription call failed, as its error body says.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub enum McpSubscriptionErrorBody {
    /// The request is invalid.
    InvalidParams {
        /// What is wrong.
        message: String,
    },
    /// No subscription has this key.
    NotFound,
    /// The user holds the most subscriptions allowed.
    ResourceExhausted {
        /// The limit.
        max: u32,
    },
    /// The callback endpoint failed verification.
    CallbackEndpointError {
        /// The failure category.
        reason: McpEndpointFailure,
    },
    /// Something on our side failed.
    Internal,
}

/// A subscription made or refreshed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct McpSubscribeResult {
    /// Derived subscription id.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub id: McpSubscriptionId,
    /// When the subscription lapses unless refreshed.
    pub refresh_before: DateTime<Utc>,
    /// The filter delivery evaluates.
    #[cfg_attr(feature = "inbound", schema(value_type = Object))]
    pub filter: McpEventFilter,
}

/// Why a callback endpoint was not accepted, as the spec's `lastError`
/// categories. Never carries the endpoint's own response.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display, strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub enum McpEndpointFailure {
    /// Unreachable or refused.
    ConnectionRefused,
    /// No response in time.
    Timeout,
    /// TLS failed.
    TlsError,
    /// A 4xx answer.
    Http4xx,
    /// A 5xx answer.
    Http5xx,
    /// Answered 2xx without echoing the challenge.
    ChallengeFailed,
}

/// The `EventOccurrence` a webhook delivery carries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpEventOccurrence {
    /// The broker event id.
    pub event_id: String,
    /// The subscription's MCP event type.
    pub name: String,
    /// When the event was taken in.
    pub timestamp: DateTime<Utc>,
    /// The broker envelope, as webhooks deliver it.
    pub data: serde_json::Value,
    /// Always `null`: Macro events are emit-only.
    pub cursor: Option<String>,
}

impl McpEventOccurrence {
    /// The occurrence of `event` for a subscription to `name`, as the
    /// subscription's profile shapes it: under MCP's, the event's own id and
    /// envelope; under ChatGPT's, the delivery's id `message_id` (which is
    /// also its `webhook-id`) and the envelope without people's ids.
    #[must_use]
    pub fn new(
        name: &str,
        event: &NormalizedWebhookEvent,
        profile: McpDeliveryProfile,
        message_id: &str,
        subscriber: &MacroUserIdStr<'_>,
    ) -> Self {
        let (event_id, data) = match profile {
            McpDeliveryProfile::Mcp => (event.event_id.clone(), event.broker_envelope.clone()),
            McpDeliveryProfile::Chatgpt => (
                message_id.to_owned(),
                without_people(&event.broker_envelope, subscriber),
            ),
        };
        Self {
            event_id,
            name: name.to_owned(),
            timestamp: event.occurred_at,
            data,
            cursor: None,
        }
    }
}

/// The endpoint verification envelope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum McpControlEnvelope {
    /// Proves the endpoint wants deliveries: it echoes `challenge`.
    Verification {
        /// Single-use nonce.
        challenge: String,
    },
}

/// Versioned queue payload for delivering one event to one MCP subscription.
///
/// Shares the webhook queue; its fields differ from
/// [`crate::domain::models::WebhookEventQueueMessage`]'s, so each parses as
/// only one of the two, and a worker that predates it acknowledges it as
/// malformed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpEventQueueMessage {
    /// Queue contract version.
    pub version: u8,
    /// Subscription row to deliver to.
    pub mcp_subscription_id: Uuid,
    /// The delivery's `webhook-id`, the same on every attempt.
    pub webhook_message_id: String,
    /// Normalized broker event to deliver.
    pub event: NormalizedWebhookEvent,
}

impl McpEventQueueMessage {
    /// A message for one subscription, with a fresh `webhook-id`.
    #[must_use]
    pub fn new(mcp_subscription_id: Uuid, event: NormalizedWebhookEvent) -> Self {
        Self {
            version: MCP_EVENT_QUEUE_MESSAGE_VERSION,
            mcp_subscription_id,
            webhook_message_id: new_message_id(),
            event,
        }
    }

    /// Whether this crate reads this contract version.
    #[must_use]
    pub fn has_supported_version(&self) -> bool {
        self.version == MCP_EVENT_QUEUE_MESSAGE_VERSION
    }
}

/// A random `webhook-id`: unique per message, never derived from the event.
#[must_use]
pub fn new_message_id() -> String {
    format!("{MESSAGE_ID_PREFIX}{}", Uuid::now_v7().simple())
}

/// The result of one delivery attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpDeliveryOutcome {
    /// The endpoint accepted it.
    Delivered,
    /// Worth retrying.
    Retryable(McpEndpointFailure),
    /// Never worth retrying (410, 413, or an endpoint that is not allowed).
    Permanent,
}

/// What matching an event reads of one subscription.
#[derive(Debug, Clone, PartialEq)]
pub struct McpMatchCandidate {
    /// Row id, which a queued delivery names.
    pub id: Uuid,
    /// The subscriber.
    pub user_id: MacroUserIdStr<'static>,
    /// The compiled filter.
    pub filter: McpEventFilter,
}
