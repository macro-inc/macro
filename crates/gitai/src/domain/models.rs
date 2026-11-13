use std::fmt;
use std::str::FromStr;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Utc};
use rand::RngCore as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use uuid::Uuid;

/// Repositories the service accepts data for, as `host/owner/name`. Events
/// for any other repository, or with none, are dropped before storage.
pub const ALLOWED_REPOSITORIES: &[&str] = &["github.com/macro-inc/macro"];

/// The git-ai release this server is tested against. `/worker/releases`
/// offers only this version, so an upstream wire change reaches laptops only
/// after it is bumped here.
pub const PINNED_CLIENT_VERSION: &str = "1.7.6";

/// SHA-256 of the pinned release's `SHA256SUMS` asset. The client checks the
/// downloaded file against it before trusting any checksum inside it.
pub const PINNED_SHA256SUMS_CHECKSUM: &str =
    "f1b77f2179cb6511a17fad8968fa7805c80a25da9dd9e0be7b6e15d1dff3dc17";

/// Where the pinned release's assets are downloaded from.
pub const RELEASE_DOWNLOAD_BASE_URL: &str =
    "https://github.com/git-ai-project/git-ai/releases/download";

/// Prefix of every device credential.
pub const DEVICE_CREDENTIAL_PREFIX: &str = "gitai_";

/// Random bytes behind a device credential (43 base64url characters).
const DEVICE_CREDENTIAL_SECRET_BYTES: usize = 32;

/// Longest email or hostname a credential may carry.
const MAX_IDENTITY_FIELD_LEN: usize = 255;

/// The operator's key from Doppler. It mints, lists and revokes device
/// credentials and is accepted nowhere else.
#[derive(Clone)]
pub struct SharedKey(String);

impl SharedKey {
    /// Wrap the configured key. An empty key would accept an empty header, so
    /// it is refused.
    pub fn new(key: impl Into<String>) -> Result<Self, GitaiError> {
        let key = key.into();
        if key.is_empty() {
            return Err(GitaiError::BadRequest("the shared key is empty".to_owned()));
        }
        Ok(Self(key))
    }

    /// Constant-time comparison with a presented key.
    pub fn matches(&self, presented: &str) -> bool {
        constant_time_eq::constant_time_eq(self.0.as_bytes(), presented.as_bytes())
    }
}

impl fmt::Debug for SharedKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SharedKey(…)")
    }
}

/// A device credential as presented by, or returned once to, a client.
/// [`Debug`] hides it.
#[derive(Clone, PartialEq, Eq)]
pub struct DeviceCredential(String);

impl DeviceCredential {
    /// A new `gitai_` + 32 random bytes (base64url) credential.
    pub fn generate() -> Self {
        let mut secret = [0_u8; DEVICE_CREDENTIAL_SECRET_BYTES];
        rand::rng().fill_bytes(&mut secret);
        Self(format!(
            "{DEVICE_CREDENTIAL_PREFIX}{}",
            URL_SAFE_NO_PAD.encode(secret)
        ))
    }

    /// A presented credential, or `None` when it cannot be one of ours.
    pub fn parse(raw: &str) -> Option<Self> {
        let secret = raw.strip_prefix(DEVICE_CREDENTIAL_PREFIX)?;
        let well_formed = !secret.is_empty()
            && secret
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
        well_formed.then(|| Self(raw.to_owned()))
    }

    /// The only way to read the secret.
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// What is stored and looked up instead of the secret.
    pub fn hash(&self) -> CredentialHash {
        CredentialHash(hex::encode(Sha256::digest(self.0.as_bytes())))
    }
}

impl fmt::Debug for DeviceCredential {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("DeviceCredential(gitai_…)")
    }
}

/// Lowercase hex SHA-256 of a device credential.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CredentialHash(String);

impl CredentialHash {
    /// Wrap a stored hash.
    pub fn from_stored(hex: String) -> Self {
        Self(hex)
    }

    /// The hex digest.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Opaque id of a device credential, safe to log and show.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CredentialId(Uuid);

impl CredentialId {
    /// A new time-ordered id.
    pub fn generate() -> Self {
        Self(Uuid::now_v7())
    }
}

impl fmt::Display for CredentialId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl FromStr for CredentialId {
    type Err = uuid::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self(Uuid::parse_str(s)?))
    }
}

/// The person a credential is bound to.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Email(String);

impl Email {
    /// A trimmed, lowercased address with one `@` and text on both sides.
    pub fn parse(raw: &str) -> Result<Self, GitaiError> {
        let email = raw.trim().to_lowercase();
        let parts: Vec<&str> = email.split('@').collect();
        let valid = matches!(parts.as_slice(), [local, domain] if !local.is_empty() && domain.contains('.'))
            && email.len() <= MAX_IDENTITY_FIELD_LEN
            && !email.chars().any(char::is_whitespace);
        if !valid {
            return Err(GitaiError::BadRequest("email is not an address".to_owned()));
        }
        Ok(Self(email))
    }

    /// The address.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The machine a credential is bound to.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Hostname(String);

impl Hostname {
    /// A trimmed, non-empty hostname without whitespace or control characters.
    pub fn parse(raw: &str) -> Result<Self, GitaiError> {
        let hostname = raw.trim();
        let valid = !hostname.is_empty()
            && hostname.len() <= MAX_IDENTITY_FIELD_LEN
            && !hostname
                .chars()
                .any(|c| c.is_whitespace() || c.is_control());
        if !valid {
            return Err(GitaiError::BadRequest(
                "hostname is empty or malformed".to_owned(),
            ));
        }
        Ok(Self(hostname.to_owned()))
    }

    /// The hostname.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A stored device credential, without its secret or hash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CredentialInfo {
    /// Opaque id.
    pub id: CredentialId,
    /// Bound person.
    pub email: Email,
    /// Bound machine.
    pub hostname: Hostname,
    /// When it was minted.
    pub created_at: DateTime<Utc>,
    /// Last authenticated request, updated at most every few minutes.
    /// Never stored as an explicit null: the revoke update relies on absence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<DateTime<Utc>>,
    /// When it was revoked; a revoked credential is refused.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked_at: Option<DateTime<Utc>>,
}

/// A credential just minted: the secret is shown once, here.
#[derive(Debug)]
pub struct MintedCredential {
    /// The stored metadata.
    pub info: CredentialInfo,
    /// The secret for the client's `api_key`.
    pub credential: DeviceCredential,
}

/// Who a client request is from, taken from its device credential. Stored
/// events are stamped with it; the client's `X-Author-Identity` is ignored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceIdentity {
    /// Credential id.
    pub credential_id: CredentialId,
    /// Bound person; the `author` of every metric.
    pub email: Email,
    /// Bound machine.
    pub hostname: Hostname,
}

/// What the client says about itself in headers. Informational only.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClientHeaders {
    /// `X-Distinct-ID`, the install's random id.
    pub distinct_id: Option<String>,
    /// Version from `User-Agent: git-ai/<version>`.
    pub client_version: Option<String>,
}

/// Failures the use cases report to the inbound adapters.
#[derive(Debug, thiserror::Error)]
pub enum GitaiError {
    /// Missing, unknown or revoked credential, or the wrong kind of key.
    #[error("unauthorized")]
    Unauthorized,
    /// The thing addressed does not exist.
    #[error("not found")]
    NotFound,
    /// The request is malformed.
    #[error("{0}")]
    BadRequest(String),
    /// Storage failed; the client should retry.
    #[error("internal gitai error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for GitaiError {
    fn from(report: rootcause::Report) -> Self {
        Self::Internal(report)
    }
}
