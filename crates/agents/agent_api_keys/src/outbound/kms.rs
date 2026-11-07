#[cfg(test)]
mod test;

use std::collections::HashMap;

use cursor_api_key::cipher::KmsCiphertexts;
use macro_uuid::Uuid;

use crate::domain::{
    AgentKeyCipher, AgentKeyError, EncryptedProviderApiKey, ModelProvider, ProviderApiKey, Result,
};

/// The encryption scheme this adapter writes.
const ENCRYPTION_VERSION: i16 = 1;

/// Names the purpose in the encryption context, so neither a Cursor key nor
/// any other feature's ciphertext decrypts as an agent key.
const ENCRYPTION_PURPOSE: &str = "agent-api-key";

/// Direct `kms:Encrypt` under the Cursor key's CMK, as `cursor_api_key` does:
/// a provider key is far below KMS's 4 KB limit, the authentication service
/// that saves agent keys already encrypts with that CMK, and the agent
/// harness that reads them already decrypts with it.
///
/// The context binds the agent and the provider, so KMS refuses a row moved
/// to another agent or relabelled as another provider's key.
pub struct KmsAgentKeyCipher<Kms> {
    kms: Kms,
}

impl<Kms> KmsAgentKeyCipher<Kms> {
    /// Encrypt and decrypt through `kms`.
    pub fn new(kms: Kms) -> Self {
        Self { kms }
    }
}

fn encryption_context(bot_id: Uuid, provider: ModelProvider) -> HashMap<String, String> {
    HashMap::from([
        ("macro:purpose".to_owned(), ENCRYPTION_PURPOSE.to_owned()),
        (
            "macro:encryption-version".to_owned(),
            ENCRYPTION_VERSION.to_string(),
        ),
        ("macro:bot-id".to_owned(), bot_id.to_string()),
        ("macro:provider".to_owned(), provider.as_str().to_owned()),
    ])
}

#[async_trait::async_trait]
impl<Kms: KmsCiphertexts + 'static> AgentKeyCipher for KmsAgentKeyCipher<Kms> {
    async fn encrypt(&self, bot_id: Uuid, key: &ProviderApiKey) -> Result<EncryptedProviderApiKey> {
        let (key_ciphertext, kms_key_id) = self
            .kms
            .encrypt(
                encryption_context(bot_id, key.provider()),
                key.expose().as_bytes(),
            )
            .await
            .map_err(|_| AgentKeyError::Cipher)?;
        Ok(EncryptedProviderApiKey {
            key_ciphertext,
            encryption_version: ENCRYPTION_VERSION,
            kms_key_id,
        })
    }

    async fn decrypt(
        &self,
        bot_id: Uuid,
        provider: ModelProvider,
        encrypted: &EncryptedProviderApiKey,
    ) -> Result<ProviderApiKey> {
        if encrypted.encryption_version != ENCRYPTION_VERSION {
            return Err(AgentKeyError::Cipher);
        }
        let plaintext = self
            .kms
            .decrypt(
                &encrypted.kms_key_id,
                &encrypted.key_ciphertext,
                encryption_context(bot_id, provider),
            )
            .await
            .map_err(|_| AgentKeyError::Cipher)?;
        let plaintext = std::str::from_utf8(&plaintext).map_err(|_| AgentKeyError::Cipher)?;
        ProviderApiKey::parse(provider, plaintext).map_err(|_| AgentKeyError::Cipher)
    }
}
