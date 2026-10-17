#[cfg(test)]
mod test;

use std::collections::HashMap;

use cursor_api_key::cipher::KmsCiphertexts;
use macro_uuid::Uuid;

use crate::domain::{
    EncryptedProviderApiKey, ModelProvider, ProviderApiKey, ProviderKeyCipher, Result,
    TeamProviderKeyError,
};

/// The encryption scheme this adapter writes.
const ENCRYPTION_VERSION: i16 = 1;

/// Names the purpose in the encryption context, so neither a Cursor key nor
/// any other feature's ciphertext decrypts as a team provider key.
const ENCRYPTION_PURPOSE: &str = "team-model-provider-api-key";

/// Direct `kms:Encrypt` under the Cursor key's CMK, as `cursor_api_key` does:
/// a provider key is far below KMS's 4 KB limit, and the services that
/// register and read team keys are the ones already granted that CMK.
///
/// The context binds the team and the provider, so KMS refuses a row moved to
/// another team or relabelled as another provider's key.
pub struct KmsProviderKeyCipher<Kms> {
    kms: Kms,
}

impl<Kms> KmsProviderKeyCipher<Kms> {
    /// Encrypt and decrypt through `kms`.
    pub fn new(kms: Kms) -> Self {
        Self { kms }
    }
}

fn encryption_context(team_id: Uuid, provider: ModelProvider) -> HashMap<String, String> {
    HashMap::from([
        ("macro:purpose".to_owned(), ENCRYPTION_PURPOSE.to_owned()),
        (
            "macro:encryption-version".to_owned(),
            ENCRYPTION_VERSION.to_string(),
        ),
        ("macro:team-id".to_owned(), team_id.to_string()),
        ("macro:provider".to_owned(), provider.as_str().to_owned()),
    ])
}

#[async_trait::async_trait]
impl<Kms: KmsCiphertexts + 'static> ProviderKeyCipher for KmsProviderKeyCipher<Kms> {
    async fn encrypt(
        &self,
        team_id: Uuid,
        key: &ProviderApiKey,
    ) -> Result<EncryptedProviderApiKey> {
        let (key_ciphertext, kms_key_id) = self
            .kms
            .encrypt(
                encryption_context(team_id, key.provider()),
                key.expose().as_bytes(),
            )
            .await
            .map_err(|_| TeamProviderKeyError::Cipher)?;
        Ok(EncryptedProviderApiKey {
            key_ciphertext,
            encryption_version: ENCRYPTION_VERSION,
            kms_key_id,
        })
    }

    async fn decrypt(
        &self,
        team_id: Uuid,
        provider: ModelProvider,
        encrypted: &EncryptedProviderApiKey,
    ) -> Result<ProviderApiKey> {
        if encrypted.encryption_version != ENCRYPTION_VERSION {
            return Err(TeamProviderKeyError::Cipher);
        }
        let plaintext = self
            .kms
            .decrypt(
                &encrypted.kms_key_id,
                &encrypted.key_ciphertext,
                encryption_context(team_id, provider),
            )
            .await
            .map_err(|_| TeamProviderKeyError::Cipher)?;
        let plaintext =
            std::str::from_utf8(&plaintext).map_err(|_| TeamProviderKeyError::Cipher)?;
        ProviderApiKey::parse(provider, plaintext).map_err(|_| TeamProviderKeyError::Cipher)
    }
}
