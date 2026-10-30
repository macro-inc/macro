//! An in-memory stand-in for KMS, for tests.

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicUsize, Ordering};

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use zeroize::Zeroizing;

use super::{GeneratedDataKey, WhatsAppKms, WhatsAppKmsError};

const NONCE_LENGTH: usize = 12;

/// Wraps data keys under a random in-memory key with the encryption context
/// as associated data, so like KMS it refuses to unwrap under any other
/// context or key id. Counts calls, so tests can check how often a store
/// talks to KMS.
pub struct FakeWhatsAppKms {
    kms_key_id: String,
    wrapping_key: Aes256Gcm,
    generate_calls: AtomicUsize,
    decrypt_calls: AtomicUsize,
}

impl FakeWhatsAppKms {
    /// A fake whose wrapped keys name `kms_key_id`.
    pub fn new(kms_key_id: &str) -> Self {
        let wrapping_key: [u8; 32] = rand::random();
        Self {
            kms_key_id: kms_key_id.to_owned(),
            wrapping_key: Aes256Gcm::new(&wrapping_key.into()),
            generate_calls: AtomicUsize::new(0),
            decrypt_calls: AtomicUsize::new(0),
        }
    }

    /// How many data keys were generated.
    pub fn generate_calls(&self) -> usize {
        self.generate_calls.load(Ordering::SeqCst)
    }

    /// How many data keys were unwrapped (successfully or not).
    pub fn decrypt_calls(&self) -> usize {
        self.decrypt_calls.load(Ordering::SeqCst)
    }

    fn associated_data(encryption_context: HashMap<String, String>) -> Vec<u8> {
        let sorted: BTreeMap<String, String> = encryption_context.into_iter().collect();
        let mut associated_data = Vec::new();
        for (key, value) in sorted {
            for part in [key, value] {
                associated_data.extend_from_slice(&(part.len() as u64).to_be_bytes());
                associated_data.extend_from_slice(part.as_bytes());
            }
        }
        associated_data
    }
}

impl WhatsAppKms for FakeWhatsAppKms {
    async fn generate_data_key(
        &self,
        encryption_context: HashMap<String, String>,
    ) -> Result<GeneratedDataKey, WhatsAppKmsError> {
        self.generate_calls.fetch_add(1, Ordering::SeqCst);
        let plaintext: [u8; 32] = rand::random();
        let nonce: [u8; NONCE_LENGTH] = rand::random();
        let wrapped = self
            .wrapping_key
            .encrypt(
                &Nonce::from(nonce),
                Payload {
                    msg: &plaintext,
                    aad: &Self::associated_data(encryption_context),
                },
            )
            .map_err(|_| WhatsAppKmsError::refused())?;
        Ok(GeneratedDataKey {
            plaintext: Zeroizing::new(plaintext.to_vec()),
            ciphertext: [nonce.as_slice(), &wrapped].concat(),
            kms_key_id: self.kms_key_id.clone(),
        })
    }

    async fn decrypt(
        &self,
        kms_key_id: &str,
        ciphertext: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, WhatsAppKmsError> {
        self.decrypt_calls.fetch_add(1, Ordering::SeqCst);
        if kms_key_id != self.kms_key_id {
            return Err(WhatsAppKmsError::refused());
        }
        let (nonce, wrapped) = ciphertext
            .split_first_chunk::<NONCE_LENGTH>()
            .ok_or(WhatsAppKmsError::refused())?;
        let plaintext = self
            .wrapping_key
            .decrypt(
                &Nonce::from(*nonce),
                Payload {
                    msg: wrapped,
                    aad: &Self::associated_data(encryption_context),
                },
            )
            .map_err(|_| WhatsAppKmsError::refused())?;
        Ok(Zeroizing::new(plaintext))
    }
}
