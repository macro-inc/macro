//! A grant's envelope: AES-256-GCM under a fresh KMS data key per write,
//! the data key bound by KMS encryption context to the user and app, so a
//! row copied to another user or app does not decrypt (CS-72).
//!
//! The envelope rather than direct `kms:Encrypt` because an access token is
//! a JWT that can approach KMS's 4 KB direct limit. Both make one KMS call
//! per operation; data keys are never cached.

use crate::domain::models::ConnectorId;
use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use aws_sdk_kms::error::ProvideErrorMetadata as _;
use aws_sdk_kms::primitives::Blob;
use aws_sdk_kms::types::DataKeySpec;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use zeroize::Zeroizing;

#[cfg(test)]
pub(crate) mod test;

/// The scheme this module writes, stored on every row.
pub(crate) const ENCRYPTION_VERSION: i16 = 1;
/// Names the purpose in the encryption context; the KMS key policy allows
/// only this purpose.
pub(crate) const ENCRYPTION_PURPOSE: &str = "connectors-api-app-grant";
/// AES-GCM's nonce length.
const NONCE_BYTES: usize = 12;
/// AES-256's key length.
const KEY_BYTES: usize = 32;

/// A grant in plaintext. Redacts its `Debug` and zeroizes on drop; use the
/// tokens as a request header or form field and drop it.
pub(crate) struct Grant {
    pub(crate) access_token: Zeroizing<String>,
    pub(crate) refresh_token: Zeroizing<String>,
}

/// A grant's plaintext encoding, borrowed so no unzeroized copy is made.
#[derive(Serialize)]
struct GrantRef<'a> {
    access_token: &'a str,
    refresh_token: &'a str,
}

/// A grant's plaintext encoding, read straight into [`Grant`]'s buffers.
#[derive(Deserialize)]
struct GrantOwned {
    access_token: String,
    refresh_token: String,
}

impl std::fmt::Debug for Grant {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Grant(<redacted>)")
    }
}

/// A grant's envelope, as stored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct EncryptedGrant {
    pub(crate) ciphertext: Vec<u8>,
    pub(crate) encrypted_data_key: Vec<u8>,
    pub(crate) nonce: Vec<u8>,
    pub(crate) encryption_version: i16,
    pub(crate) kms_key_id: String,
}

/// A grant that could not be sealed or opened. Says nothing about the
/// plaintext or the KMS answer, which may quote it.
#[derive(Debug, thiserror::Error)]
#[error("could not {0} a stored API app grant")]
pub(crate) struct CipherError(&'static str);

/// Data keys from KMS, as a seam tests stand in for.
///
/// Object-safe (`#[async_trait]`): the cipher holds it as `Arc<dyn _>`.
#[async_trait::async_trait]
pub(crate) trait DataKeys: Send + Sync {
    /// A fresh data key under `context`: its plaintext, its KMS ciphertext,
    /// and the key that wrapped it.
    async fn generate(&self, context: HashMap<String, String>) -> Result<DataKey, Report>;

    /// The plaintext of a data key `kms_key_id` wrapped, which KMS refuses
    /// unless `context` matches.
    async fn decrypt(
        &self,
        kms_key_id: &str,
        encrypted: &[u8],
        context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, Report>;
}

/// A data key KMS generated.
pub(crate) struct DataKey {
    pub(crate) plaintext: Zeroizing<Vec<u8>>,
    pub(crate) encrypted: Vec<u8>,
    pub(crate) key_id: String,
}

/// Seals and opens grants.
#[derive(Clone)]
pub(crate) struct GrantCipher {
    keys: Arc<dyn DataKeys>,
}

impl GrantCipher {
    /// Envelopes over KMS `key_id`, which must allow `GenerateDataKey` and
    /// `Decrypt` under [`ENCRYPTION_PURPOSE`].
    pub(crate) fn kms(client: aws_sdk_kms::Client, key_id: String) -> Self {
        Self::new(Arc::new(KmsDataKeys { client, key_id }))
    }

    pub(crate) fn new(keys: Arc<dyn DataKeys>) -> Self {
        Self { keys }
    }

    /// Seal `grant` for `user`'s connection to `app`.
    #[tracing::instrument(name = "connectors.grant_encrypt", skip_all, err)]
    pub(crate) async fn encrypt(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
        grant: &Grant,
    ) -> Result<EncryptedGrant, Report> {
        let plaintext = Zeroizing::new(
            serde_json::to_vec(&GrantRef {
                access_token: &grant.access_token,
                refresh_token: &grant.refresh_token,
            })
            .map_err(|_| Report::new(CipherError("encode")))?,
        );
        let key = self.keys.generate(context(user, app)).await?;
        let cipher = Aes256Gcm::new_from_slice(&key.plaintext)
            .map_err(|_| Report::new(CipherError("encrypt")))?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: &plaintext,
                    aad: &aad(user, app),
                },
            )
            .map_err(|_| Report::new(CipherError("encrypt")))?;

        Ok(EncryptedGrant {
            ciphertext,
            encrypted_data_key: key.encrypted,
            nonce: nonce.to_vec(),
            encryption_version: ENCRYPTION_VERSION,
            kms_key_id: key.key_id,
        })
    }

    /// Open `user`'s grant to `app`.
    #[tracing::instrument(name = "connectors.grant_decrypt", skip_all, err)]
    pub(crate) async fn decrypt(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
        envelope: &EncryptedGrant,
    ) -> Result<Grant, Report> {
        if envelope.encryption_version != ENCRYPTION_VERSION
            || envelope.nonce.len() != NONCE_BYTES
            || envelope.encrypted_data_key.is_empty()
            || envelope.kms_key_id.is_empty()
        {
            return Err(Report::new(CipherError("open")).into_dynamic());
        }
        let key = self
            .keys
            .decrypt(
                &envelope.kms_key_id,
                &envelope.encrypted_data_key,
                context(user, app),
            )
            .await?;
        if key.len() != KEY_BYTES {
            return Err(Report::new(CipherError("open")).into_dynamic());
        }
        let cipher =
            Aes256Gcm::new_from_slice(&key).map_err(|_| Report::new(CipherError("open")))?;
        let nonce: [u8; NONCE_BYTES] = envelope
            .nonce
            .as_slice()
            .try_into()
            .map_err(|_| Report::new(CipherError("open")))?;
        let plaintext = Zeroizing::new(
            cipher
                .decrypt(
                    &Nonce::from(nonce),
                    Payload {
                        msg: &envelope.ciphertext,
                        aad: &aad(user, app),
                    },
                )
                .map_err(|_| Report::new(CipherError("open")))?,
        );

        let grant: GrantOwned =
            serde_json::from_slice(&plaintext).map_err(|_| Report::new(CipherError("decode")))?;
        Ok(Grant {
            access_token: Zeroizing::new(grant.access_token),
            refresh_token: Zeroizing::new(grant.refresh_token),
        })
    }
}

/// The context KMS requires to match on decrypt.
pub(crate) fn context(
    user: &MacroUserIdStr<'static>,
    app: &ConnectorId,
) -> HashMap<String, String> {
    HashMap::from([
        ("macro:purpose".to_owned(), ENCRYPTION_PURPOSE.to_owned()),
        (
            "macro:encryption-version".to_owned(),
            ENCRYPTION_VERSION.to_string(),
        ),
        ("macro:user-id".to_owned(), user.as_ref().to_owned()),
        ("macro:app".to_owned(), app.as_str().to_owned()),
    ])
}

/// The AES-GCM associated data: the same binding, so a ciphertext moved
/// under another row's data key fails too. JSON keeps the boundaries
/// unambiguous.
fn aad(user: &MacroUserIdStr<'static>, app: &ConnectorId) -> Vec<u8> {
    serde_json::json!([
        ENCRYPTION_PURPOSE,
        ENCRYPTION_VERSION,
        user.as_ref(),
        app.as_str()
    ])
    .to_string()
    .into_bytes()
}

/// [`DataKeys`] over AWS KMS.
struct KmsDataKeys {
    client: aws_sdk_kms::Client,
    key_id: String,
}

#[async_trait::async_trait]
impl DataKeys for KmsDataKeys {
    async fn generate(&self, context: HashMap<String, String>) -> Result<DataKey, Report> {
        let output = self
            .client
            .generate_data_key()
            .key_id(&self.key_id)
            .key_spec(DataKeySpec::Aes256)
            .set_encryption_context(Some(context))
            .send()
            .await
            .map_err(|error| {
                tracing::warn!(kms.error_code = error.code(), "KMS refused a data key");
                Report::new(CipherError("seal"))
            })?;
        let missing = || Report::new(CipherError("seal"));

        Ok(DataKey {
            plaintext: Zeroizing::new(output.plaintext.ok_or_else(missing)?.into_inner()),
            encrypted: output.ciphertext_blob.ok_or_else(missing)?.into_inner(),
            key_id: output.key_id.ok_or_else(missing)?,
        })
    }

    async fn decrypt(
        &self,
        kms_key_id: &str,
        encrypted: &[u8],
        context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, Report> {
        let output = self
            .client
            .decrypt()
            .key_id(kms_key_id)
            .ciphertext_blob(Blob::new(encrypted))
            .set_encryption_context(Some(context))
            .send()
            .await
            .map_err(|error| {
                tracing::warn!(
                    kms.error_code = error.code(),
                    "KMS refused to open a data key"
                );
                Report::new(CipherError("open"))
            })?;

        Ok(Zeroizing::new(
            output
                .plaintext
                .ok_or_else(|| Report::new(CipherError("open")))?
                .into_inner(),
        ))
    }
}
