//! The Signal implementation a client must use to talk to the fake server,
//! and the server's noise certificate chain.
//!
//! The client verifies the server's noise certificate against WhatsApp's
//! root key ([`WA_CERT_PUB_KEY`]), whose private half only WhatsApp has. The
//! fake server signs its chain with [`test_root_key`] instead, and
//! [`TestSignal`] is libsignal with one change: a signature checked against
//! WhatsApp's root key is checked against the test root key. Everything else
//! (prekey signatures, pairing signatures, sessions, sender keys) is the real
//! libsignal from `whatsmeow_signal`.

use std::sync::Arc;

use async_trait::async_trait;
use prost::Message;
use whatsmeow::Signal;
use whatsmeow::handshake::{WA_CERT_ISSUER_SERIAL, WA_CERT_PUB_KEY};
use whatsmeow::proto::wa_cert::CertChain;
use whatsmeow::proto::wa_cert::cert_chain::NoiseCertificate;
use whatsmeow::proto::wa_cert::cert_chain::noise_certificate::Details;
use whatsmeow::signal::{
    CiphertextMessage, CurveSignatures, PreKeyBundle, SenderKeyName, SignalAddress, SignalError,
    SignalProtocol, SignalProtocolStore,
};
use whatsmeow::util::keys::{KeyPair, new_key_pair, new_key_pair_from_private_key};
use whatsmeow_signal::{LibsignalCurveSignatures, LibsignalProtocol};

/// The private key of the test root that stands in for WhatsApp's root.
const TEST_ROOT_PRIVATE_KEY: [u8; 32] = [
    0x58, 0x0b, 0x6c, 0x2e, 0x91, 0x3a, 0x47, 0xd2, 0x1f, 0x88, 0x05, 0x6e, 0xc4, 0x39, 0xa7, 0x12,
    0x7d, 0x50, 0xe3, 0x9b, 0x26, 0x41, 0xbf, 0x0c, 0x73, 0xd8, 0x6a, 0x15, 0xf0, 0x2c, 0x94, 0x4e,
];

/// The test root key pair: the fake server's intermediate certificate is
/// signed with it.
pub fn test_root_key() -> KeyPair {
    new_key_pair_from_private_key(TEST_ROOT_PRIVATE_KEY)
}

/// libsignal, except that WhatsApp's root key is replaced by
/// [`test_root_key`] when verifying signatures. Hand it to
/// [`whatsmeow::Client::new`] for clients that connect to the fake server.
pub struct TestSignal {
    protocol: LibsignalProtocol,
    signatures: LibsignalCurveSignatures,
    root_public: [u8; 32],
}

impl Default for TestSignal {
    fn default() -> Self {
        TestSignal {
            protocol: LibsignalProtocol::new(),
            signatures: LibsignalCurveSignatures::new(),
            root_public: test_root_key().public,
        }
    }
}

/// A [`TestSignal`] as the trait object [`whatsmeow::Client::new`] takes.
pub fn test_signal() -> Arc<dyn Signal> {
    Arc::new(TestSignal::default())
}

impl CurveSignatures for TestSignal {
    fn calculate_signature(&self, private_key: &[u8; 32], message: &[u8]) -> [u8; 64] {
        self.signatures.calculate_signature(private_key, message)
    }

    fn verify_signature(
        &self,
        public_key: &[u8; 32],
        message: &[u8],
        signature: &[u8; 64],
    ) -> bool {
        let public_key = if *public_key == WA_CERT_PUB_KEY {
            &self.root_public
        } else {
            public_key
        };
        self.signatures
            .verify_signature(public_key, message, signature)
    }
}

#[async_trait]
impl SignalProtocol for TestSignal {
    async fn process_bundle(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        bundle: &PreKeyBundle,
    ) -> Result<(), SignalError> {
        self.protocol.process_bundle(store, address, bundle).await
    }

    async fn encrypt(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        plaintext: &[u8],
    ) -> Result<CiphertextMessage, SignalError> {
        self.protocol.encrypt(store, address, plaintext).await
    }

    async fn decrypt_pre_key_message(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        self.protocol
            .decrypt_pre_key_message(store, address, ciphertext)
            .await
    }

    async fn decrypt_message(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        self.protocol
            .decrypt_message(store, address, ciphertext)
            .await
    }

    async fn create_sender_key_distribution_message(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
    ) -> Result<Vec<u8>, SignalError> {
        self.protocol
            .create_sender_key_distribution_message(store, name)
            .await
    }

    async fn process_sender_key_distribution_message(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
        message: &[u8],
    ) -> Result<(), SignalError> {
        self.protocol
            .process_sender_key_distribution_message(store, name, message)
            .await
    }

    async fn group_encrypt(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        self.protocol.group_encrypt(store, name, plaintext).await
    }

    async fn group_decrypt(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        self.protocol.group_decrypt(store, name, ciphertext).await
    }
}

/// The fake server's noise identity: its static key and the certificate
/// chain that binds it to the test root.
pub(crate) struct ServerIdentity {
    pub(crate) static_key: KeyPair,
    pub(crate) certificate_chain: Vec<u8>,
}

impl ServerIdentity {
    pub(crate) fn generate() -> ServerIdentity {
        const NOT_BEFORE: u64 = 1_600_000_000;
        const NOT_AFTER: u64 = 4_000_000_000;
        const INTERMEDIATE_SERIAL: u32 = 7;
        let signatures = LibsignalCurveSignatures::new();
        let root = test_root_key();
        let intermediate = new_key_pair();
        let static_key = new_key_pair();
        let intermediate_details = Details {
            serial: Some(INTERMEDIATE_SERIAL),
            issuer_serial: Some(WA_CERT_ISSUER_SERIAL),
            key: Some(intermediate.public.to_vec()),
            not_before: Some(NOT_BEFORE),
            not_after: Some(NOT_AFTER),
        }
        .encode_to_vec();
        let leaf_details = Details {
            serial: Some(INTERMEDIATE_SERIAL + 1),
            issuer_serial: Some(INTERMEDIATE_SERIAL),
            key: Some(static_key.public.to_vec()),
            not_before: Some(NOT_BEFORE),
            not_after: Some(NOT_AFTER),
        }
        .encode_to_vec();
        let certificate_chain = CertChain {
            intermediate: Some(NoiseCertificate {
                signature: Some(
                    signatures
                        .calculate_signature(&root.private, &intermediate_details)
                        .to_vec(),
                ),
                details: Some(intermediate_details),
            }),
            leaf: Some(NoiseCertificate {
                signature: Some(
                    signatures
                        .calculate_signature(&intermediate.private, &leaf_details)
                        .to_vec(),
                ),
                details: Some(leaf_details),
            }),
        }
        .encode_to_vec();
        ServerIdentity {
            static_key,
            certificate_chain,
        }
    }
}
