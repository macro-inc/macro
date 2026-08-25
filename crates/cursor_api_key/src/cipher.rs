//! Encrypting a Cursor API key with AWS KMS.
//!
//! `kms:Encrypt` directly, not the envelope pattern
//! `microsoft_oauth_grants` uses. The envelope exists so that large plaintext
//! can be encrypted locally under a cheap data key that KMS only has to wrap;
//! a `crsr_` key is around 60 bytes, far inside KMS's 4 KB direct limit, so
//! there is nothing to amortize. Both designs make one KMS call per operation,
//! so the envelope's cost here is pure: a data key column, a nonce column, an
//! AES-GCM implementation to review, and a nonce-reuse rule for a future reader
//! to break.
//!
//! What matters is kept:
//!
//! - **KMS gates every read.** The key never exists outside KMS, so there is no
//!   long-lived data key that, once leaked, decrypts rows forever without
//!   another KMS call.
//! - **The ciphertext is bound to one user.** The encryption context is passed
//!   on encrypt and required to match on decrypt, and *KMS* enforces that, with
//!   a CloudTrail record either way. A row copied into another user's id fails
//!   to decrypt. This is the property `mcp_servers.credentials` lacks — one
//!   process-wide AES key and no additional authenticated data, so its
//!   ciphertexts are interchangeable between rows.
//!
//! The [`KmsCiphertexts`] seam exists so the cipher's own rules — context
//! construction, identity normalization, version checking — are testable
//! without an AWS account.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use aws_sdk_kms::primitives::Blob;
use zeroize::Zeroizing;

/// The encryption scheme this crate writes. Stored on every row so that adding
/// a second scheme is additive rather than a migration.
pub const ENCRYPTION_VERSION: i16 = 1;

/// Names the purpose in the encryption context, so a ciphertext from another
/// feature cannot be decrypted as a Cursor key even under the same KMS key.
const ENCRYPTION_PURPOSE: &str = "cursor-api-key";

/// The prefix every Cursor API key carries.
const CURSOR_KEY_PREFIX: &str = "crsr_";

/// A Cursor API key in plaintext.
///
/// Redacts its own `Debug` and zeroizes on drop. Both matter: the key used to
/// be a bare `String` in a `Debug`-deriving config, so a single
/// `tracing::debug!(?config)` would have written a live user credential into a
/// log file.
pub struct CursorApiKey(Zeroizing<String>);

impl CursorApiKey {
    /// Accept a key the user supplied, checking its shape.
    ///
    /// Shape only — this cannot tell a real key from forty random characters
    /// behind the right prefix. A caller registering a key should also confirm
    /// it against `GET /v1/me`, which turns "looks like a key" into "works, and
    /// belongs to this account".
    ///
    /// Keys arrive pasted, so surrounding whitespace and quotes are stripped
    /// before the check rather than rejected: the API treats those as an
    /// invalid key rather than a malformed request, which is a confusing way to
    /// find out about a stray newline.
    pub fn parse(supplied: &str) -> Result<Self, MalformedCursorApiKey> {
        let trimmed = supplied
            .trim()
            .trim_matches(|character| character == '"' || character == '\'');
        if !trimmed.starts_with(CURSOR_KEY_PREFIX) {
            return Err(MalformedCursorApiKey);
        }
        if trimmed.len() <= CURSOR_KEY_PREFIX.len() {
            return Err(MalformedCursorApiKey);
        }
        Ok(Self(Zeroizing::new(trimmed.to_owned())))
    }

    /// The plaintext key. Only for the transport that authenticates with it —
    /// never for a log, a span field, an error, or an API response.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for CursorApiKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("CursorApiKey(redacted)")
    }
}

/// A supplied string that does not look like a Cursor API key.
///
/// Carries nothing: the offending value is a credential the user just typed,
/// and the length or prefix of a rejected secret is not worth putting in an
/// error that may be logged.
#[derive(Debug, thiserror::Error)]
#[error("value does not look like a Cursor API key")]
pub struct MalformedCursorApiKey;

/// An encrypted key, ready to persist.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EncryptedCursorApiKey {
    /// The KMS ciphertext blob.
    pub key_ciphertext: Vec<u8>,
    /// The scheme that produced the ciphertext.
    pub encryption_version: i16,
    /// The KMS key that encrypted it.
    pub kms_key_id: String,
}

/// Encrypts and decrypts a user's Cursor API key.
#[async_trait::async_trait]
pub trait CursorApiKeyCipher: Send + Sync {
    /// Encrypt `key` so that only `macro_user_id` can decrypt it.
    async fn encrypt(
        &self,
        macro_user_id: &str,
        key: CursorApiKey,
    ) -> Result<EncryptedCursorApiKey, CursorApiKeyCipherError>;

    /// Decrypt a key belonging to `macro_user_id`.
    async fn decrypt(
        &self,
        macro_user_id: &str,
        encrypted: &EncryptedCursorApiKey,
    ) -> Result<CursorApiKey, CursorApiKeyCipherError>;
}

/// The KMS operations this cipher needs, as a seam tests can stand in for.
#[async_trait::async_trait]
pub trait KmsCiphertexts: Send + Sync {
    /// Encrypt `plaintext` under the configured key and `encryption_context`,
    /// returning the ciphertext blob and the key that produced it.
    async fn encrypt(
        &self,
        encryption_context: HashMap<String, String>,
        plaintext: &[u8],
    ) -> Result<(Vec<u8>, String), KmsCiphertextsError>;

    /// Decrypt `ciphertext`, which KMS refuses unless `encryption_context`
    /// matches what it was encrypted with.
    async fn decrypt(
        &self,
        kms_key_id: &str,
        ciphertext: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, KmsCiphertextsError>;
}

/// A KMS operation failed.
///
/// Deliberately opaque: the AWS error can distinguish "wrong encryption
/// context" from "no permission", and a caller that can tell those apart can
/// probe. The detail belongs in CloudTrail, not in our response.
#[derive(Debug, thiserror::Error)]
#[error("cursor api key kms operation failed")]
pub struct KmsCiphertextsError;

/// Why a key could not be encrypted or decrypted.
///
/// Opaque for the same reason [`KmsCiphertextsError`] is; the variants
/// distinguish only what a caller can act on.
#[derive(Debug, thiserror::Error)]
pub enum CursorApiKeyCipherError {
    /// The KMS call failed, including because the encryption context did not
    /// match — which is what a row moved between users looks like.
    #[error("cursor api key kms operation failed")]
    Kms(#[from] KmsCiphertextsError),
    /// The user id cannot be part of an encryption context.
    #[error("cursor api key owner is malformed")]
    MalformedOwner,
    /// The decrypted bytes are not a Cursor API key.
    #[error("cursor api key plaintext is malformed")]
    MalformedPlaintext,
    /// The row was written by a scheme this build does not know.
    #[error("cursor api key uses unsupported encryption version {0}")]
    UnsupportedVersion(i16),
}

/// The direct-KMS cipher.
#[derive(Clone)]
pub struct KmsCursorApiKeyCipher<Kms> {
    kms: Kms,
}

impl<Kms> KmsCursorApiKeyCipher<Kms> {
    /// Wrap the KMS operations this cipher runs on.
    pub fn new(kms: Kms) -> Self {
        Self { kms }
    }
}

#[async_trait::async_trait]
impl<Kms> CursorApiKeyCipher for KmsCursorApiKeyCipher<Kms>
where
    Kms: KmsCiphertexts,
{
    async fn encrypt(
        &self,
        macro_user_id: &str,
        key: CursorApiKey,
    ) -> Result<EncryptedCursorApiKey, CursorApiKeyCipherError> {
        let owner = KeyOwner::new(macro_user_id)?;
        let (key_ciphertext, kms_key_id) = self
            .kms
            .encrypt(owner.encryption_context(), key.expose().as_bytes())
            .await?;
        Ok(EncryptedCursorApiKey {
            key_ciphertext,
            encryption_version: ENCRYPTION_VERSION,
            kms_key_id,
        })
    }

    async fn decrypt(
        &self,
        macro_user_id: &str,
        encrypted: &EncryptedCursorApiKey,
    ) -> Result<CursorApiKey, CursorApiKeyCipherError> {
        // Checked before the KMS call: a version this build cannot read is our
        // bug to report, not a request worth spending a KMS quota on.
        if encrypted.encryption_version != ENCRYPTION_VERSION {
            return Err(CursorApiKeyCipherError::UnsupportedVersion(
                encrypted.encryption_version,
            ));
        }
        let owner = KeyOwner::new(macro_user_id)?;
        let plaintext = self
            .kms
            .decrypt(
                &encrypted.kms_key_id,
                &encrypted.key_ciphertext,
                owner.encryption_context(),
            )
            .await?;
        let plaintext = std::str::from_utf8(&plaintext)
            .map_err(|_| CursorApiKeyCipherError::MalformedPlaintext)?;
        CursorApiKey::parse(plaintext).map_err(|_| CursorApiKeyCipherError::MalformedPlaintext)
    }
}

/// The identity a ciphertext is bound to.
///
/// One type with one constructor, so the encryption context cannot be built two
/// slightly different ways in two places — a context that differs by whitespace
/// or case is a row nothing can ever decrypt again.
struct KeyOwner {
    macro_user_id: String,
}

impl KeyOwner {
    fn new(macro_user_id: &str) -> Result<Self, CursorApiKeyCipherError> {
        let macro_user_id = macro_user_id.trim().to_owned();
        if macro_user_id.is_empty() || macro_user_id.contains('\0') {
            return Err(CursorApiKeyCipherError::MalformedOwner);
        }
        Ok(Self { macro_user_id })
    }

    /// The context KMS requires to match on decrypt.
    ///
    /// Bound to the Macro user only. Deliberately not to any Cursor-side
    /// identity: that changes when a user swaps Cursor accounts, and a row
    /// bound to it would become permanently unreadable.
    fn encryption_context(&self) -> HashMap<String, String> {
        HashMap::from([
            ("macro:purpose".to_owned(), ENCRYPTION_PURPOSE.to_owned()),
            (
                "macro:encryption-version".to_owned(),
                ENCRYPTION_VERSION.to_string(),
            ),
            ("macro:user-id".to_owned(), self.macro_user_id.clone()),
        ])
    }
}

/// [`KmsCiphertexts`] over a real AWS KMS client.
#[derive(Clone)]
pub struct AwsKmsCiphertexts {
    client: aws_sdk_kms::Client,
    /// The key to encrypt under. `None` for a reader: decryption names the key
    /// the row recorded, so a service that only ever decrypts has no key id to
    /// configure and should not be made to invent one.
    kms_key_id: Option<String>,
}

impl AwsKmsCiphertexts {
    /// Encrypt under `kms_key_id`, and decrypt.
    ///
    /// This must be a key separate from the one protecting Microsoft refresh
    /// tokens. The argument is IAM rather than rotation: sharing it would grant
    /// whatever decrypts Cursor keys — the agent harness, which runs agent code
    /// — decrypt permission on everyone's mailbox credentials.
    pub fn new(client: aws_sdk_kms::Client, kms_key_id: String) -> Self {
        Self {
            client,
            kms_key_id: Some(kms_key_id),
        }
    }

    /// Decrypt only.
    ///
    /// For the agent harness, which reads users' keys to run their sessions and
    /// never writes one. Registering keys is the authentication service's job,
    /// so a harness that could encrypt would only be a harness whose IAM role
    /// grants more than it uses.
    pub fn decrypting(client: aws_sdk_kms::Client) -> Self {
        Self {
            client,
            kms_key_id: None,
        }
    }
}

#[async_trait::async_trait]
impl KmsCiphertexts for AwsKmsCiphertexts {
    async fn encrypt(
        &self,
        encryption_context: HashMap<String, String>,
        plaintext: &[u8],
    ) -> Result<(Vec<u8>, String), KmsCiphertextsError> {
        // A decrypt-only cipher asked to encrypt is a wiring mistake, not a
        // runtime condition: fail rather than pick a key.
        let kms_key_id = self.kms_key_id.as_ref().ok_or(KmsCiphertextsError)?;
        let response = self
            .client
            .encrypt()
            .key_id(kms_key_id)
            .plaintext(Blob::new(plaintext))
            .set_encryption_context(Some(encryption_context))
            .send()
            .await
            .map_err(|_| KmsCiphertextsError)?;
        let ciphertext = response.ciphertext_blob.ok_or(KmsCiphertextsError)?;
        // The response's key id is the fully qualified ARN even when the
        // request used an alias, which is what a row should record.
        let kms_key_id = response.key_id.unwrap_or_else(|| kms_key_id.clone());
        Ok((ciphertext.into_inner(), kms_key_id))
    }

    async fn decrypt(
        &self,
        kms_key_id: &str,
        ciphertext: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, KmsCiphertextsError> {
        let response = self
            .client
            .decrypt()
            // Named explicitly rather than left to the ciphertext's own
            // metadata, so a blob encrypted under some other key cannot be
            // decrypted here just because we happen to have access to it.
            .key_id(kms_key_id)
            .ciphertext_blob(Blob::new(ciphertext))
            .set_encryption_context(Some(encryption_context))
            .send()
            .await
            .map_err(|_| KmsCiphertextsError)?;
        let plaintext = response.plaintext.ok_or(KmsCiphertextsError)?;
        Ok(Zeroizing::new(plaintext.into_inner()))
    }
}
