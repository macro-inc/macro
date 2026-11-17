//! Sealing stored values under an account's data key, with
//! [`kms_envelope`]. Each value is bound to the account, its store and its key
//! (labels `store | key…`), so a ciphertext copied to another row, store or
//! account fails to decrypt instead of being read as that row's value.

#[cfg(test)]
mod test;

use kms_envelope::cipher::{CipherError, DataKey};
use uuid::Uuid;

use crate::error::WhatsAppStoreError;

/// The scheme this crate writes, stored on the device row so a second scheme
/// can be added without a migration.
pub const ENCRYPTION_VERSION: i16 = 1;

/// An account's data key in plaintext (see [`DataKey`]).
pub(crate) type WhatsAppDataKey = DataKey;

impl From<CipherError> for WhatsAppStoreError {
    fn from(error: CipherError) -> Self {
        match error {
            CipherError::Malformed => Self::Malformed,
            CipherError::Encrypt => Self::Encrypt,
            CipherError::Decrypt => Self::Decrypt,
        }
    }
}

/// Which store a value belongs to: the `store` column of
/// `whatsapp_store_value`, and part of every value's associated data.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub(crate) enum StoreName {
    Device,
    Identity,
    Session,
    SenderKey,
    AppStateSyncKey,
    AppStateVersion,
    Contact,
    ChatSettings,
    MessageSecret,
    NctSalt,
    LidByPn,
    PnByLid,
    PreKey,
    AppStateMutationMac,
    PrivacyToken,
    BufferedEvent,
    OutgoingEvent,
    /// Not a store: blobs sealed for callers by [`crate::PgWhatsAppStore::seal`],
    /// whose "key" is their purpose.
    Sealed,
}

impl StoreName {
    pub(crate) fn as_str(self) -> &'static str {
        self.into()
    }
}

pub(crate) use kms_envelope::cipher::Sealed;

/// Seals and opens the values of one account.
pub(crate) struct ValueCipher(kms_envelope::cipher::ValueCipher);

impl ValueCipher {
    pub(crate) fn new(account_id: Uuid, data_key: &WhatsAppDataKey) -> Self {
        Self(kms_envelope::cipher::ValueCipher::new(account_id, data_key))
    }

    /// Encrypts a value stored under `key` in `store`. A composite key passes
    /// one part per component.
    pub(crate) fn seal(
        &self,
        store: StoreName,
        key: &[&[u8]],
        plaintext: &[u8],
    ) -> Result<Sealed, WhatsAppStoreError> {
        Ok(self.0.seal(&labels(store, key), plaintext)?)
    }

    /// Decrypts a value read from under `key` in `store`. Fails if the
    /// ciphertext was written for any other account, store or key.
    pub(crate) fn open(
        &self,
        store: StoreName,
        key: &[&[u8]],
        nonce: &[u8],
        value: &[u8],
    ) -> Result<Vec<u8>, WhatsAppStoreError> {
        Ok(self.0.open(&labels(store, key), nonce, value)?)
    }

    /// [`ValueCipher::seal`] into one column.
    pub(crate) fn seal_blob(
        &self,
        store: StoreName,
        key: &[&[u8]],
        plaintext: &[u8],
    ) -> Result<Vec<u8>, WhatsAppStoreError> {
        Ok(self.0.seal_blob(&labels(store, key), plaintext)?)
    }

    /// Opens a [`ValueCipher::seal_blob`] output.
    pub(crate) fn open_blob(
        &self,
        store: StoreName,
        key: &[&[u8]],
        blob: &[u8],
    ) -> Result<zeroize::Zeroizing<Vec<u8>>, WhatsAppStoreError> {
        Ok(self.0.open_blob(&labels(store, key), blob)?)
    }
}

fn labels<'a>(store: StoreName, key: &[&'a [u8]]) -> Vec<&'a [u8]> {
    std::iter::once(store.as_str().as_bytes())
        .chain(key.iter().copied())
        .collect()
}
