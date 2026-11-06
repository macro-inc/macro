//! The Signal protocol for the whatsmeow port: [`Libsignal`] implements
//! [`whatsmeow::signal::CurveSignatures`] and
//! [`whatsmeow::signal::SignalProtocol`], so [`libsignal`] is a
//! [`whatsmeow::Signal`].
//!
//! Curve25519 keys and XEdDSA signatures come from Signal's `libsignal-core`
//! unmodified. The Double Ratchet, X3DH and sender keys are Signal's
//! `libsignal-protocol` modules, vendored and patched in [`protocol`] because
//! WhatsApp still speaks session version 3 (X3DH, no Kyber) and an older
//! sender key wire format, which current libsignal releases refuse. See
//! `AGENTS.md` and `NOTICE`.
//!
//! Session and sender key records cross the store boundary as libsignal's
//! `RecordStructure` and `SenderKeyRecordStructure` protobufs.
#![deny(missing_docs)]

#[cfg(test)]
mod interop_test;
mod protocol;
mod store;
#[cfg(test)]
mod test;
#[cfg(test)]
mod test_store;

use std::sync::{Arc, Mutex, PoisonError};

use async_trait::async_trait;
use libsignal_core::curve::{PrivateKey, PublicKey};
use rand::SeedableRng;
use rand::rngs::StdRng;
use whatsmeow::signal::{
    CiphertextMessage, CiphertextType, CurveSignatures, PreKeyBundle, SenderKeyName, SignalAddress,
    SignalError, SignalProtocol, SignalProtocolStore,
};

use crate::protocol::error::SignalProtocolError;
use crate::protocol::messages::{
    self, PreKeySignalMessage, SenderKeyDistributionMessage, SignalMessage,
};
use crate::protocol::{group_cipher, session, session_cipher};
use crate::store::ProtocolStore;

/// Where an operation's randomness comes from: the operating system, or (in
/// tests) a seeded generator so outputs can be replayed byte for byte.
#[derive(Default)]
struct RandomSource {
    seeded: Option<Mutex<StdRng>>,
}

impl RandomSource {
    /// A generator for one operation. Operations hold it across awaits, so it
    /// is an owned, `Send` CSPRNG rather than the thread-local one.
    fn generator(&self) -> StdRng {
        match &self.seeded {
            Some(seeded) => {
                StdRng::from_rng(&mut *seeded.lock().unwrap_or_else(PoisonError::into_inner))
            }
            None => StdRng::from_os_rng(),
        }
    }

    #[cfg(test)]
    fn seeded(seed: u64) -> Self {
        Self {
            seeded: Some(Mutex::new(StdRng::seed_from_u64(seed))),
        }
    }
}

/// libsignal for the whatsmeow port: XEdDSA signatures as libsignal's
/// `curve25519` module makes them (the Edwards sign bit in the top bit of the
/// last byte), and the protocol operations whatsmeow runs (X3DH session
/// setup, the Double Ratchet, sender keys for groups) in WhatsApp's wire
/// format. Implements both halves of [`whatsmeow::Signal`]; see
/// [`libsignal`] for the trait object a client takes.
#[derive(Default)]
pub struct Libsignal {
    random: RandomSource,
}

/// The older name of [`Libsignal`] as the protocol half.
pub type LibsignalProtocol = Libsignal;

/// The older name of [`Libsignal`] as the signatures half.
pub type LibsignalCurveSignatures = Libsignal;

/// [`Libsignal`] as the trait object [`whatsmeow::Client::new`] takes.
pub fn libsignal() -> Arc<dyn whatsmeow::Signal> {
    Arc::new(Libsignal::new())
}

impl Libsignal {
    /// Uses randomness from the operating system.
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    fn seeded(seed: u64) -> Self {
        Self {
            random: RandomSource::seeded(seed),
        }
    }
}

impl CurveSignatures for Libsignal {
    fn calculate_signature(&self, private_key: &[u8; 32], message: &[u8]) -> [u8; 64] {
        let private_key = PrivateKey::deserialize(private_key)
            .expect("libsignal accepts every 32-byte Curve25519 private key");
        let signature = private_key
            .calculate_signature(message, &mut self.random.generator())
            .expect("libsignal signs with every Curve25519 private key");
        (*signature)
            .try_into()
            .expect("XEdDSA signatures are 64 bytes")
    }

    fn verify_signature(
        &self,
        public_key: &[u8; 32],
        message: &[u8],
        signature: &[u8; 64],
    ) -> bool {
        PublicKey::from_djb_public_key_bytes(public_key)
            .is_ok_and(|public_key| public_key.verify_signature(message, signature))
    }
}

fn signal_error(error: SignalProtocolError) -> SignalError {
    match error {
        SignalProtocolError::UntrustedIdentity => SignalError::UntrustedIdentity,
        SignalProtocolError::DuplicatedMessage(_, _) => SignalError::OldCounter,
        SignalProtocolError::NoSenderKeyState => SignalError::NoSenderKeyForUser,
        SignalProtocolError::Store(error) => SignalError::Store(error),
        error => SignalError::Internal(rootcause::Report::new(error).into_dynamic()),
    }
}

#[async_trait]
impl SignalProtocol for Libsignal {
    async fn process_bundle(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        bundle: &PreKeyBundle,
    ) -> Result<(), SignalError> {
        session::process_prekey_bundle(
            address,
            &ProtocolStore(store),
            bundle,
            &mut self.random.generator(),
        )
        .await
        .map_err(signal_error)
    }

    async fn encrypt(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        plaintext: &[u8],
    ) -> Result<CiphertextMessage, SignalError> {
        let message = session_cipher::message_encrypt(plaintext, address, &ProtocolStore(store))
            .await
            .map_err(signal_error)?;
        Ok(match message {
            messages::CiphertextMessage::SignalMessage(message) => CiphertextMessage {
                kind: CiphertextType::Whisper,
                serialized: message.serialized().to_vec(),
            },
            messages::CiphertextMessage::PreKeySignalMessage(message) => CiphertextMessage {
                kind: CiphertextType::PreKey,
                serialized: message.serialized().to_vec(),
            },
        })
    }

    async fn decrypt_pre_key_message(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        let message = PreKeySignalMessage::try_from(ciphertext).map_err(signal_error)?;
        session_cipher::message_decrypt_prekey(
            &message,
            address,
            &ProtocolStore(store),
            &mut self.random.generator(),
        )
        .await
        .map_err(signal_error)
    }

    async fn decrypt_message(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        let message = SignalMessage::try_from(ciphertext).map_err(signal_error)?;
        session_cipher::message_decrypt_signal(
            &message,
            address,
            &ProtocolStore(store),
            &mut self.random.generator(),
        )
        .await
        .map_err(signal_error)
    }

    async fn create_sender_key_distribution_message(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
    ) -> Result<Vec<u8>, SignalError> {
        let message = group_cipher::create_sender_key_distribution_message(
            name,
            &ProtocolStore(store),
            &mut self.random.generator(),
        )
        .await
        .map_err(signal_error)?;
        Ok(message.serialized().to_vec())
    }

    async fn process_sender_key_distribution_message(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
        message: &[u8],
    ) -> Result<(), SignalError> {
        let message = SenderKeyDistributionMessage::try_from(message).map_err(signal_error)?;
        group_cipher::process_sender_key_distribution_message(name, &message, &ProtocolStore(store))
            .await
            .map_err(signal_error)
    }

    async fn group_encrypt(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        let message = group_cipher::group_encrypt(
            &ProtocolStore(store),
            name,
            plaintext,
            &mut self.random.generator(),
        )
        .await
        .map_err(signal_error)?;
        Ok(message.serialized().to_vec())
    }

    async fn group_decrypt(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        group_cipher::group_decrypt(ciphertext, &ProtocolStore(store), name)
            .await
            .map_err(signal_error)
    }
}
