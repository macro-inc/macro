use base64::Engine;
use base64::engine::general_purpose::URL_SAFE;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;
use strum::Display;
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize)]
pub struct GmailWebhookPayload {
    pub message: PubSubMessage,
    pub subscription: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PubSubMessage {
    #[serde(deserialize_with = "deserialize_base64url_json_data")]
    pub data: GmailNotificationData,

    pub message_id: String,

    pub publish_time: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GmailNotificationData {
    pub email_address: String,

    pub history_id: u64,
}

fn deserialize_base64url_json_data<'de, D>(
    deserializer: D,
) -> Result<GmailNotificationData, D::Error>
where
    D: Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;

    let decoded_bytes = URL_SAFE
        .decode(s.as_bytes())
        .map_err(serde::de::Error::custom)?;

    let json_str = String::from_utf8(decoded_bytes).map_err(serde::de::Error::custom)?;

    serde_json::from_str(&json_str).map_err(serde::de::Error::custom)
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebhookPubsubMessage {
    pub link_id: Uuid,
    // the operation being performed
    pub operation: WebhookOperation,
}

#[derive(Debug, Deserialize, Serialize, Clone, Display)]
#[serde(rename_all = "snake_case")]
pub enum WebhookOperation {
    // The original message we get from gmail when there is a change to the user's inbox.
    // Contains the new history_id for the user's inbox.
    GmailMessage(GmailMessagePayload),
    // Operation to upsert a message
    UpsertMessage(UpsertMessagePayload),
    // Operation to delete a message
    DeleteMessage(DeleteMessagePayload),
    // Operation to add/remove labels from a message
    UpdateLabels(UpdateLabelsPayload),
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct GmailMessagePayload {
    pub history_id: u64,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct UpsertMessagePayload {
    pub provider_message_id: String,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct DeleteMessagePayload {
    pub provider_message_id: String,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct UpdateLabelsPayload {
    pub provider_message_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_webhook_payload() {
        let json_str = r#"
        {
          "message": {
            "data": "eyJlbWFpbEFkZHJlc3MiOiAidXNlckBleGFtcGxlLmNvbSIsICJoaXN0b3J5SWQiOiAxMjM0NTY3ODkwfQ==",
            "messageId": "2070443601311540",
            "publishTime": "2021-02-26T19:13:55.749Z"
          },
          "subscription": "projects/myproject/subscriptions/mysubscription"
        }
        "#;

        let payload: GmailWebhookPayload = serde_json::from_str(json_str).unwrap();

        assert_eq!(
            payload.subscription,
            "projects/myproject/subscriptions/mysubscription"
        );
        assert_eq!(payload.message.message_id, "2070443601311540");
        assert_eq!(payload.message.publish_time, "2021-02-26T19:13:55.749Z");
        assert_eq!(payload.message.data.email_address, "user@example.com");
        assert_eq!(payload.message.data.history_id, 1234567890);
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JwksResponse {
    pub keys: Vec<JwkKey>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JwkKey {
    pub kid: String,
    pub alg: String,
    pub kty: String,
    pub n: String,
    pub e: String,
    pub use_: Option<String>,
    #[serde(rename = "use")]
    pub use_field: Option<String>,
}

pub type KeyMap = HashMap<String, JwkKey>;

/// Cached Google public keys mapped by key ID (kid)
#[derive(Debug, Serialize, Deserialize)]
pub struct GooglePublicKeys {
    pub max_age_seconds: u64,
    pub keys: KeyMap,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GoogleJwtClaims {
    /// The issuer (iss) should be https://accounts.google.com
    pub iss: String,
    /// The subject (sub) is the service account ID
    pub sub: String,
    /// Should match gmail_client's audience attribute
    pub aud: String,
    /// Issued at time (Unix timestamp)
    pub iat: u64,
    /// Expiration time (Unix timestamp)
    pub exp: u64,
    /// The service account email
    pub email: String,
    /// Whether the email is verified
    #[serde(rename = "email_verified")]
    pub email_verified: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum JwtVerificationError {
    #[error("Failed to decode JWT header: {0}")]
    HeaderDecodeError(#[source] anyhow::Error),

    #[error("JWT header missing 'kid' field")]
    MissingKid,

    #[error("No matching public key found for kid: {0}")]
    KeyNotFound(String),

    #[error("Unsupported key type: {0}, only RSA is supported")]
    UnsupportedKeyType(String),

    #[error("Failed to create decoding key: {0}")]
    DecodingKeyCreationError(#[source] anyhow::Error),

    #[error("JWT validation failed: {0}")]
    ValidationError(#[source] anyhow::Error),

    #[error("Invalid audience.")]
    InvalidAudience,

    #[error("Invalid issuer.")]
    InvalidIssuer,

    #[error("Token expired at: {0}")]
    TokenExpired(chrono::DateTime<chrono::Utc>),

    #[error("Invalid token signature")]
    InvalidSignature,
}
