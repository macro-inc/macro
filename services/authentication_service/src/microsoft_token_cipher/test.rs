use std::sync::{Arc, Mutex};

use super::*;

const OWNER: &str = "fusionauth-user-id";
const MAILBOX: &str = "person@example.com";
const REFRESH_TOKEN: &str = "private-microsoft-refresh-token";

#[tokio::test]
async fn round_trip_uses_normalized_identity_and_stable_kms_context() {
    let provider = FakeDataKeyProvider::default();
    let calls = provider.calls.clone();
    let cipher = EnvelopeMicrosoftTokenCipher::new(provider);

    let envelope = cipher
        .encrypt(
            "  FUSIONAUTH-USER-ID  ",
            "Person+outlook@EXAMPLE.COM",
            token(),
        )
        .await
        .expect("token should encrypt");
    let plaintext = cipher
        .decrypt(OWNER, MAILBOX, &envelope)
        .await
        .expect("token should decrypt");

    assert_eq!(plaintext.as_str(), REFRESH_TOKEN);
    assert_ne!(envelope.refresh_token_ciphertext, REFRESH_TOKEN.as_bytes());
    assert_eq!(envelope.encryption_version, ENCRYPTION_VERSION);
    assert_eq!(envelope.kms_key_id, "fake-kms-key");

    let calls = calls.lock().expect("fake call lock should be available");
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0], calls[1]);
    assert_eq!(
        calls[0],
        HashMap::from([
            ("macro:purpose".to_owned(), ENCRYPTION_PURPOSE.to_owned()),
            (
                "macro:encryption-version".to_owned(),
                ENCRYPTION_VERSION.to_string(),
            ),
            ("macro:fusionauth-user-id".to_owned(), OWNER.to_owned()),
            ("macro:microsoft-mailbox".to_owned(), MAILBOX.to_owned()),
        ])
    );
}

#[tokio::test]
async fn wrong_owner_aad_is_rejected() {
    let cipher = test_cipher();
    let envelope = encrypt(&cipher).await;

    let error = cipher
        .decrypt("another-owner", MAILBOX, &envelope)
        .await
        .err()
        .expect("an envelope must be bound to its owner");

    assert!(matches!(error, MicrosoftTokenCipherError::DecryptionFailed));
}

#[tokio::test]
async fn wrong_mailbox_aad_is_rejected() {
    let cipher = test_cipher();
    let envelope = encrypt(&cipher).await;

    let error = cipher
        .decrypt(OWNER, "another@example.com", &envelope)
        .await
        .err()
        .expect("an envelope must be bound to its mailbox");

    assert!(matches!(error, MicrosoftTokenCipherError::DecryptionFailed));
}

#[tokio::test]
async fn tampered_ciphertext_is_rejected() {
    let cipher = test_cipher();
    let mut envelope = encrypt(&cipher).await;
    envelope.refresh_token_ciphertext[0] ^= 1;

    let error = cipher
        .decrypt(OWNER, MAILBOX, &envelope)
        .await
        .err()
        .expect("tampered ciphertext must not authenticate");

    assert!(matches!(error, MicrosoftTokenCipherError::DecryptionFailed));
}

#[tokio::test]
async fn malformed_envelopes_are_rejected_before_decryption() {
    let cipher = test_cipher();
    let envelope = encrypt(&cipher).await;
    let malformed_envelopes = [
        EncryptedMicrosoftToken {
            nonce: vec![0; AES_GCM_NONCE_LENGTH - 1],
            ..envelope.clone()
        },
        EncryptedMicrosoftToken {
            refresh_token_ciphertext: vec![0; AES_GCM_TAG_LENGTH - 1],
            ..envelope.clone()
        },
        EncryptedMicrosoftToken {
            encrypted_data_key: Vec::new(),
            ..envelope.clone()
        },
        EncryptedMicrosoftToken {
            kms_key_id: "  ".to_owned(),
            ..envelope
        },
    ];

    for malformed in malformed_envelopes {
        let error = cipher
            .decrypt(OWNER, MAILBOX, &malformed)
            .await
            .err()
            .expect("malformed envelope must be rejected");
        assert!(matches!(
            error,
            MicrosoftTokenCipherError::MalformedEnvelope
        ));
    }
}

#[tokio::test]
async fn unsupported_encryption_version_is_rejected() {
    let cipher = test_cipher();
    let mut envelope = encrypt(&cipher).await;
    envelope.encryption_version += 1;

    let error = cipher
        .decrypt(OWNER, MAILBOX, &envelope)
        .await
        .err()
        .expect("unknown encryption versions must be rejected");

    assert!(matches!(
        error,
        MicrosoftTokenCipherError::UnsupportedVersion(version)
            if version == ENCRYPTION_VERSION + 1
    ));
}

type TestCipher = EnvelopeMicrosoftTokenCipher<FakeDataKeyProvider>;

fn test_cipher() -> TestCipher {
    EnvelopeMicrosoftTokenCipher::new(FakeDataKeyProvider::default())
}

async fn encrypt(cipher: &TestCipher) -> EncryptedMicrosoftToken {
    cipher
        .encrypt(OWNER, MAILBOX, token())
        .await
        .expect("token should encrypt")
}

fn token() -> MicrosoftRefreshToken {
    MicrosoftRefreshToken::new(REFRESH_TOKEN.to_owned())
}

#[derive(Clone, Default)]
struct FakeDataKeyProvider {
    calls: Arc<Mutex<Vec<HashMap<String, String>>>>,
}

#[async_trait::async_trait]
impl DataKeyProvider for FakeDataKeyProvider {
    async fn generate_data_key(
        &self,
        encryption_context: HashMap<String, String>,
    ) -> Result<GeneratedDataKey, DataKeyProviderError> {
        self.record(encryption_context);
        Ok(GeneratedDataKey {
            plaintext: Zeroizing::new(vec![42; AES_256_KEY_LENGTH]),
            encrypted: vec![7; 48],
            key_id: "fake-kms-key".to_owned(),
        })
    }

    async fn decrypt_data_key(
        &self,
        _key_id: &str,
        _encrypted_data_key: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, DataKeyProviderError> {
        self.record(encryption_context);
        Ok(Zeroizing::new(vec![42; AES_256_KEY_LENGTH]))
    }
}

impl FakeDataKeyProvider {
    fn record(&self, encryption_context: HashMap<String, String>) {
        self.calls
            .lock()
            .expect("fake call lock should be available")
            .push(encryption_context);
    }
}
