//! Encrypting stored values under an account's data key.
//!
//! AES-256-GCM with a random 96-bit nonce per write, so the same data key can
//! seal any number of values: at 2^32 writes per account the collision
//! probability of random nonces is still below 2^-32. Each value is bound by
//! its associated data to the account, the store and the key it was written
//! under, so a ciphertext copied to another row, store or account fails to
//! decrypt instead of being read as that row's value.

#[cfg(test)]
mod test;

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::error::WhatsAppStoreError;

/// The scheme this crate writes, stored on the device row so a second scheme
/// can be added without a migration.
pub const ENCRYPTION_VERSION: i16 = 1;

const NONCE_LENGTH: usize = 12;
const DATA_KEY_LENGTH: usize = 32;

/// An account's data key in plaintext.
///
/// Lives only in memory, from the KMS `Decrypt` (or `GenerateDataKey`) when a
/// replica takes the account's lease until the store is dropped. Zeroizes on
/// drop, redacts its `Debug`, and has no serialization.
pub(crate) struct WhatsAppDataKey(Zeroizing<[u8; DATA_KEY_LENGTH]>);

impl WhatsAppDataKey {
    /// Accepts exactly 32 bytes of key material.
    pub(crate) fn from_plaintext(plaintext: &[u8]) -> Result<Self, WhatsAppStoreError> {
        let key: [u8; DATA_KEY_LENGTH] = plaintext
            .try_into()
            .map_err(|_| WhatsAppStoreError::Malformed)?;
        Ok(Self(Zeroizing::new(key)))
    }
}

impl std::fmt::Debug for WhatsAppDataKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("WhatsAppDataKey(redacted)")
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

/// A sealed value, ready for its `nonce` and `value` columns.
pub(crate) struct Sealed {
    pub(crate) nonce: Vec<u8>,
    pub(crate) value: Vec<u8>,
}

/// Seals and opens the values of one account.
pub(crate) struct ValueCipher {
    account_id: Uuid,
    // `aes-gcm` is built with `zeroize`, so the key schedule is wiped on drop.
    aead: Aes256Gcm,
}

impl ValueCipher {
    pub(crate) fn new(account_id: Uuid, data_key: &WhatsAppDataKey) -> Self {
        Self {
            account_id,
            aead: Aes256Gcm::new(data_key.0.as_ref().into()),
        }
    }

    /// Encrypts a value stored under `key` in `store`. A composite key passes
    /// one part per component.
    pub(crate) fn seal(
        &self,
        store: StoreName,
        key: &[&[u8]],
        plaintext: &[u8],
    ) -> Result<Sealed, WhatsAppStoreError> {
        let nonce: [u8; NONCE_LENGTH] = rand::random();
        let associated_data = self.associated_data(store, key);
        let value = self
            .aead
            .encrypt(
                &Nonce::from(nonce),
                Payload {
                    msg: plaintext,
                    aad: &associated_data,
                },
            )
            .map_err(|_| WhatsAppStoreError::Encrypt)?;
        Ok(Sealed {
            nonce: nonce.to_vec(),
            value,
        })
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
        let nonce: [u8; NONCE_LENGTH] =
            nonce.try_into().map_err(|_| WhatsAppStoreError::Decrypt)?;
        let associated_data = self.associated_data(store, key);
        self.aead
            .decrypt(
                &Nonce::from(nonce),
                Payload {
                    msg: value,
                    aad: &associated_data,
                },
            )
            .map_err(|_| WhatsAppStoreError::Decrypt)
    }

    /// `account_id | store | key…`: the account's 16 bytes, then each other
    /// part prefixed by its length as a big-endian u32, so no two different
    /// (store, key) pairs encode to the same bytes.
    fn associated_data(&self, store: StoreName, key: &[&[u8]]) -> Vec<u8> {
        let store = store.as_str().as_bytes();
        let mut associated_data = Vec::with_capacity(
            16 + 4 + store.len() + key.iter().map(|part| 4 + part.len()).sum::<usize>(),
        );
        associated_data.extend_from_slice(self.account_id.as_bytes());
        for part in std::iter::once(store).chain(key.iter().copied()) {
            // Parts are keys and names, far below 4 GiB.
            let length = u32::try_from(part.len()).unwrap_or(u32::MAX);
            associated_data.extend_from_slice(&length.to_be_bytes());
            associated_data.extend_from_slice(part);
        }
        associated_data
    }
}
