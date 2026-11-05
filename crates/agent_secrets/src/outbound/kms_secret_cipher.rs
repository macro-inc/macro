//! Direct `kms:Encrypt` of a secret, as `cursor_api_key` and
//! `agent_api_keys` do: a secret is at most 4 KB, inside KMS's direct limit,
//! so there is no data key to amortize. It shares their CMK: the
//! authentication service that serves secrets already encrypts with it.
//!
//! The encryption context binds the agent and the secret's name, so KMS
//! refuses a row moved to another agent or renamed.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use cursor_api_key::cipher::KmsCiphertexts;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{AgentSecretError, EncryptedSecret, SecretName, SecretValue};
use crate::domain::ports::SecretCipher;

/// The encryption scheme this adapter writes.
const ENCRYPTION_VERSION: i16 = 1;

/// Names the purpose in the encryption context, so no other feature's
/// ciphertext under the same CMK decrypts as an agent secret.
const ENCRYPTION_PURPOSE: &str = "agent-secret";

/// A KMS call failed. Opaque, as [`cursor_api_key::cipher::KmsCiphertextsError`].
#[derive(Debug, thiserror::Error)]
#[error("agent secret kms operation failed")]
pub struct AgentSecretKmsError;

/// A stored secret this build cannot read.
#[derive(Debug, thiserror::Error)]
#[error("agent secret uses unsupported encryption version {0}")]
pub struct UnsupportedEncryptionVersion(i16);

/// KMS cipher for agent secrets.
pub struct KmsSecretCipher<Kms> {
    kms: Kms,
}

impl<Kms> KmsSecretCipher<Kms> {
    /// Encrypt and decrypt through `kms`.
    pub fn new(kms: Kms) -> Self {
        Self { kms }
    }
}

/// The context KMS requires to match on decrypt. One constructor, so a
/// context can't be built two slightly different ways.
fn encryption_context(
    agent_user_id: &MacroUserIdStr<'_>,
    name: &SecretName,
) -> HashMap<String, String> {
    HashMap::from([
        ("macro:purpose".to_owned(), ENCRYPTION_PURPOSE.to_owned()),
        (
            "macro:encryption-version".to_owned(),
            ENCRYPTION_VERSION.to_string(),
        ),
        (
            "macro:agent-user-id".to_owned(),
            agent_user_id.as_ref().to_owned(),
        ),
        ("macro:secret-name".to_owned(), name.as_str().to_owned()),
    ])
}

impl<Kms: KmsCiphertexts + 'static> SecretCipher for KmsSecretCipher<Kms> {
    async fn encrypt(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &SecretName,
        value: &SecretValue,
    ) -> Result<EncryptedSecret, AgentSecretError> {
        let (ciphertext, kms_key_id) = self
            .kms
            .encrypt(
                encryption_context(agent_user_id, name),
                value.expose().as_bytes(),
            )
            .await
            .map_err(|_| AgentSecretError::internal(AgentSecretKmsError))?;

        Ok(EncryptedSecret {
            ciphertext,
            encryption_version: ENCRYPTION_VERSION,
            kms_key_id,
        })
    }

    async fn decrypt(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &SecretName,
        encrypted: &EncryptedSecret,
    ) -> Result<SecretValue, AgentSecretError> {
        if encrypted.encryption_version != ENCRYPTION_VERSION {
            return Err(AgentSecretError::internal(UnsupportedEncryptionVersion(
                encrypted.encryption_version,
            )));
        }

        let plaintext = self
            .kms
            .decrypt(
                &encrypted.kms_key_id,
                &encrypted.ciphertext,
                encryption_context(agent_user_id, name),
            )
            .await
            .map_err(|_| AgentSecretError::internal(AgentSecretKmsError))?;
        let plaintext = std::str::from_utf8(&plaintext)
            .map_err(|_| AgentSecretError::internal(AgentSecretKmsError))?;

        SecretValue::parse(plaintext.to_string())
            .map_err(|_| AgentSecretError::internal(AgentSecretKmsError))
    }
}
