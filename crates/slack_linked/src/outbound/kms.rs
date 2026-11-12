//! Sealing Slack secrets with `kms_envelope`: a fresh data key per sealed
//! blob, bound by its encryption context to a purpose, the owner and the
//! account or sign-in attempt. DSS only seals pasted sessions
//! ([`SlackLoginInputSealer`], purpose `slack-login-input`, `GenerateDataKey`
//! only); the session service seals and opens everything
//! ([`SlackSecrets`]).

use crate::domain::{
    events::StoredSecret,
    models::SessionSubmission,
    ports::{LoginInputSealer, SealedBlob},
};
use async_trait::async_trait;
use external_chat::domain::{models::ExternalChatError, ports::ExternalChatResult};
use kms_envelope::{
    cipher::{DataKey, ValueCipher},
    kms::{EnvelopeKms, KmsError, encryption_context},
};
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashMap;
use uuid::Uuid;
use zeroize::Zeroizing;

/// The scheme sealed blobs are written with.
pub const ENCRYPTION_VERSION: i16 = 1;

/// What a sealed blob is for; IAM conditions on it
/// (`kms:EncryptionContext:macro:purpose`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "kebab-case")]
pub enum SecretPurpose {
    /// An account's `{token, d, d-s}`; only the session service opens it.
    SlackSession,
    /// A sign-in attempt's private state between steps.
    SlackLogin,
    /// A pasted or captured session, sealed by DSS.
    SlackLoginInput,
}

impl SecretPurpose {
    fn label(self) -> &'static str {
        self.into()
    }
}

fn context(purpose: SecretPurpose, user_id: &str, scope: Uuid) -> HashMap<String, String> {
    encryption_context(
        purpose.label(),
        ENCRYPTION_VERSION,
        &[("user-id", user_id), ("scope-id", &scope.to_string())],
    )
}

fn kms_failure(error: KmsError) -> rootcause::Report<ExternalChatError> {
    if error.is_retryable() {
        rootcause::Report::new(ExternalChatError::Unavailable)
    } else {
        rootcause::Report::new(ExternalChatError::Internal)
    }
}

/// Seal `plaintext` under a fresh data key for `scope` of `user_id`.
pub async fn seal(
    kms: &impl EnvelopeKms,
    purpose: SecretPurpose,
    user_id: &str,
    scope: Uuid,
    plaintext: &[u8],
) -> ExternalChatResult<StoredSecret> {
    let generated = kms
        .generate_data_key(context(purpose, user_id, scope))
        .await
        .map_err(kms_failure)?;
    let key = DataKey::from_plaintext(&generated.plaintext)
        .map_err(|_| ExternalChatError::Internal)?;
    let ciphertext = ValueCipher::new(scope, &key)
        .seal_blob(&[purpose.label().as_bytes()], plaintext)
        .map_err(|_| ExternalChatError::Internal)?;
    Ok(StoredSecret {
        ciphertext,
        data_key: generated.ciphertext,
        kms_key_id: generated.kms_key_id,
        encryption_version: ENCRYPTION_VERSION,
    })
}

/// Why a stored secret didn't open.
#[derive(Debug, thiserror::Error)]
pub enum OpenError {
    /// KMS is unreachable or throttling; nothing is wrong with the secret.
    #[error("kms is unavailable")]
    Unavailable,
    /// KMS refused, or the blob doesn't decrypt: it never will.
    #[error("the secret is unreadable")]
    Unreadable,
}

/// Open a secret sealed by [`seal`] for the same purpose, owner and scope.
pub async fn open(
    kms: &impl EnvelopeKms,
    purpose: SecretPurpose,
    user_id: &str,
    scope: Uuid,
    secret: &StoredSecret,
) -> Result<Zeroizing<Vec<u8>>, OpenError> {
    if secret.encryption_version != ENCRYPTION_VERSION {
        return Err(OpenError::Unreadable);
    }
    let plaintext = kms
        .decrypt(
            &secret.kms_key_id,
            &secret.data_key,
            context(purpose, user_id, scope),
        )
        .await
        .map_err(|error| {
            if error.is_retryable() {
                OpenError::Unavailable
            } else {
                OpenError::Unreadable
            }
        })?;
    let key = DataKey::from_plaintext(&plaintext).map_err(|_| OpenError::Unreadable)?;
    ValueCipher::new(scope, &key)
        .open_blob(&[purpose.label().as_bytes()], &secret.ciphertext)
        .map_err(|_| OpenError::Unreadable)
}

/// DSS's sealer for pasted and captured sessions.
pub struct SlackLoginInputSealer<Kms> {
    kms: Kms,
}

impl<Kms: EnvelopeKms> SlackLoginInputSealer<Kms> {
    /// Seal with `kms`, which needs only `GenerateDataKey` for
    /// `slack-login-input`.
    pub fn new(kms: Kms) -> Self {
        Self { kms }
    }
}

#[async_trait]
impl<Kms: EnvelopeKms + 'static> LoginInputSealer for SlackLoginInputSealer<Kms> {
    async fn seal(
        &self,
        user: &MacroUserIdStr<'_>,
        attempt: Uuid,
        submission: &SessionSubmission,
    ) -> ExternalChatResult<SealedBlob> {
        let plaintext = Zeroizing::new(
            serde_json::to_vec(submission).map_err(|_| ExternalChatError::Internal)?,
        );
        let sealed = seal(
            &self.kms,
            SecretPurpose::SlackLoginInput,
            user.as_ref(),
            attempt,
            &plaintext,
        )
        .await?;
        Ok(SealedBlob {
            ciphertext: sealed.ciphertext,
            data_key: sealed.data_key,
            kms_key_id: sealed.kms_key_id,
            encryption_version: sealed.encryption_version,
        })
    }
}
