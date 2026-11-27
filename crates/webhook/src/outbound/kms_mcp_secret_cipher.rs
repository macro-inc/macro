//! KMS encryption of MCP subscription signing secrets.
#[cfg(test)]
#[path = "kms_mcp_secret_cipher_test.rs"]
mod test;

use crate::domain::mcp::models::McpSecretCiphertext;
use crate::domain::mcp::ports::McpSecretCipher;
use cursor_api_key::cipher::KmsCiphertexts;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashMap;
use std::sync::Arc;
use webhook_signature::standard::SigningSecret;

/// The encryption scheme this adapter writes.
const ENCRYPTION_VERSION: i16 = 1;

/// Names the purpose in the encryption context, so no other feature's
/// ciphertext under the same key decrypts as a subscription secret.
const ENCRYPTION_PURPOSE: &str = "mcp-event-subscription-secret";

/// Direct `kms:Encrypt` of the `whsec_` secret (well under KMS's 4 KB
/// limit). The agent harness encrypts with its MCP OAuth key when an agent
/// subscribes; the document storage service, which delivers, only decrypts,
/// naming the key the row recorded.
///
/// The context binds the subscriber, so a row moved to another user does not
/// decrypt.
pub struct KmsMcpSecretCipher<Kms> {
    kms: Arc<Kms>,
}

// Not derived: the KMS client is shared, so the cipher clones without it
// being `Clone`.
impl<Kms> Clone for KmsMcpSecretCipher<Kms> {
    fn clone(&self) -> Self {
        Self {
            kms: Arc::clone(&self.kms),
        }
    }
}

impl<Kms> KmsMcpSecretCipher<Kms> {
    /// Encrypt and decrypt through `kms`.
    pub fn new(kms: Kms) -> Self {
        Self { kms: Arc::new(kms) }
    }
}

/// A secret could not be encrypted or decrypted.
///
/// Opaque, like [`cursor_api_key::cipher::KmsCiphertextsError`]: the detail
/// belongs in CloudTrail.
#[derive(Debug, thiserror::Error)]
#[error("mcp subscription secret cipher failed")]
pub struct McpSecretCipherError;

fn encryption_context(user_id: &MacroUserIdStr<'static>) -> HashMap<String, String> {
    HashMap::from([
        ("macro:purpose".to_owned(), ENCRYPTION_PURPOSE.to_owned()),
        (
            "macro:encryption-version".to_owned(),
            ENCRYPTION_VERSION.to_string(),
        ),
        ("macro:user-id".to_owned(), user_id.as_ref().to_owned()),
    ])
}

impl<Kms: KmsCiphertexts + 'static> McpSecretCipher for KmsMcpSecretCipher<Kms> {
    type Err = McpSecretCipherError;

    async fn encrypt(
        &self,
        user_id: &MacroUserIdStr<'static>,
        secret: &SigningSecret,
    ) -> Result<McpSecretCiphertext, Self::Err> {
        let (ciphertext, kms_key_id) = self
            .kms
            .encrypt(encryption_context(user_id), secret.expose().as_bytes())
            .await
            .map_err(|_| McpSecretCipherError)?;
        Ok(McpSecretCiphertext {
            ciphertext,
            kms_key_id,
            encryption_version: ENCRYPTION_VERSION,
        })
    }

    async fn decrypt(
        &self,
        user_id: &MacroUserIdStr<'static>,
        ciphertext: &McpSecretCiphertext,
    ) -> Result<SigningSecret, Self::Err> {
        if ciphertext.encryption_version != ENCRYPTION_VERSION {
            return Err(McpSecretCipherError);
        }
        let plaintext = self
            .kms
            .decrypt(
                &ciphertext.kms_key_id,
                &ciphertext.ciphertext,
                encryption_context(user_id),
            )
            .await
            .map_err(|_| McpSecretCipherError)?;
        let plaintext = std::str::from_utf8(&plaintext).map_err(|_| McpSecretCipherError)?;
        SigningSecret::parse(plaintext).map_err(|_| McpSecretCipherError)
    }
}
