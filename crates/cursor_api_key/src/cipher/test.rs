//! Tests for the cipher's own rules — context construction, identity
//! normalization, version checking, shape validation — against a fake KMS.
//!
//! The fake enforces the one property KMS enforces for real: a ciphertext only
//! decrypts under the encryption context it was encrypted with. Everything
//! worth testing here is about whether we hand KMS the right context, which is
//! exactly what an AWS account would not tell us any more clearly.

use super::*;
use std::sync::{Arc, Mutex};

const OWNER: &str = "macro-user-1";
const OTHER_OWNER: &str = "macro-user-2";
const KEY: &str = "crsr_0123456789abcdef";

fn cipher() -> KmsCursorApiKeyCipher<FakeKms> {
    KmsCursorApiKeyCipher::new(FakeKms::default())
}

#[tokio::test]
async fn a_key_round_trips_for_its_owner() {
    let cipher = cipher();
    let encrypted = cipher
        .encrypt(OWNER, CursorApiKey::parse(KEY).expect("well-formed key"))
        .await
        .expect("encrypts");

    assert_eq!(encrypted.encryption_version, ENCRYPTION_VERSION);
    assert!(!encrypted.key_ciphertext.is_empty());
    assert_eq!(
        cipher
            .decrypt(OWNER, &encrypted)
            .await
            .expect("decrypts")
            .expose(),
        KEY
    );
}

/// The property the whole design rests on: a row moved to another user must not
/// decrypt. This is what `mcp_servers.credentials` gets wrong.
#[tokio::test]
async fn another_users_id_cannot_decrypt_the_row() {
    let cipher = cipher();
    let encrypted = cipher
        .encrypt(OWNER, CursorApiKey::parse(KEY).expect("well-formed key"))
        .await
        .expect("encrypts");

    let error = cipher
        .decrypt(OTHER_OWNER, &encrypted)
        .await
        .expect_err("a row belonging to someone else must not decrypt");
    assert!(matches!(error, CursorApiKeyCipherError::Kms(_)));
}

/// The context is what KMS checks, so its exact contents are the contract.
#[tokio::test]
async fn the_encryption_context_binds_purpose_version_and_user() {
    let kms = FakeKms::default();
    let cipher = KmsCursorApiKeyCipher::new(kms.clone());
    cipher
        .encrypt(OWNER, CursorApiKey::parse(KEY).expect("well-formed key"))
        .await
        .expect("encrypts");

    let contexts = kms.contexts();
    let [context] = contexts.as_slice() else {
        panic!("expected exactly one KMS call, got {contexts:?}");
    };
    assert_eq!(
        context,
        &HashMap::from([
            ("macro:purpose".to_owned(), "cursor-api-key".to_owned()),
            ("macro:encryption-version".to_owned(), "1".to_owned()),
            ("macro:user-id".to_owned(), OWNER.to_owned()),
        ])
    );
}

/// A user id that only differs by surrounding whitespace is the same user; if
/// it were not, the row it wrote would be unreadable forever.
#[tokio::test]
async fn the_owner_id_is_normalized_before_it_becomes_context() {
    let cipher = cipher();
    let encrypted = cipher
        .encrypt(
            &format!("  {OWNER}\n"),
            CursorApiKey::parse(KEY).expect("well-formed key"),
        )
        .await
        .expect("encrypts");

    assert_eq!(
        cipher
            .decrypt(OWNER, &encrypted)
            .await
            .expect("the trimmed id is the same owner")
            .expose(),
        KEY
    );
}

#[tokio::test]
async fn an_unusable_owner_id_is_rejected_before_kms() {
    let kms = FakeKms::default();
    let cipher = KmsCursorApiKeyCipher::new(kms.clone());

    for owner in ["", "   ", "macro\0user"] {
        let error = cipher
            .encrypt(owner, CursorApiKey::parse(KEY).expect("well-formed key"))
            .await
            .expect_err("an id that cannot be encryption context must be refused");
        assert!(matches!(error, CursorApiKeyCipherError::MalformedOwner));
    }
    assert!(
        kms.contexts().is_empty(),
        "a malformed owner must not reach KMS"
    );
}

/// A version this build cannot read is reported without spending a KMS call.
#[tokio::test]
async fn an_unsupported_version_is_rejected_before_kms() {
    let kms = FakeKms::default();
    let cipher = KmsCursorApiKeyCipher::new(kms.clone());
    let encrypted = EncryptedCursorApiKey {
        key_ciphertext: vec![1, 2, 3],
        encryption_version: ENCRYPTION_VERSION + 1,
        kms_key_id: "fake-kms-key".to_owned(),
    };

    let error = cipher
        .decrypt(OWNER, &encrypted)
        .await
        .expect_err("an unknown scheme must not be guessed at");
    assert!(matches!(
        error,
        CursorApiKeyCipherError::UnsupportedVersion(version) if version == ENCRYPTION_VERSION + 1
    ));
    assert!(kms.contexts().is_empty());
}

/// Plaintext that is not a Cursor key means the row is not what we think it
/// is; that is a failure, not something to hand to the Cursor API.
#[tokio::test]
async fn plaintext_that_is_not_a_cursor_key_is_rejected() {
    let kms = FakeKms::default();
    kms.plant(OWNER, b"not-a-cursor-key");
    let cipher = KmsCursorApiKeyCipher::new(kms.clone());

    let error = cipher
        .decrypt(
            OWNER,
            &EncryptedCursorApiKey {
                key_ciphertext: FakeKms::PLANTED.to_vec(),
                encryption_version: ENCRYPTION_VERSION,
                kms_key_id: "fake-kms-key".to_owned(),
            },
        )
        .await
        .expect_err("a decrypted non-key must be rejected");
    assert!(matches!(error, CursorApiKeyCipherError::MalformedPlaintext));
}

#[test]
fn key_parsing_accepts_pasted_keys_and_rejects_the_rest() {
    assert_eq!(
        CursorApiKey::parse("  \"crsr_abc\"\n")
            .expect("quotes and whitespace are stripped")
            .expose(),
        "crsr_abc"
    );
    for rejected in ["", "crsr_", "sk-ant-abc", "abc_crsr_abc"] {
        assert!(
            CursorApiKey::parse(rejected).is_err(),
            "{rejected:?} should be rejected"
        );
    }
}

/// The key must never print itself: it used to be a bare `String` behind a
/// derived `Debug`, so one `tracing::debug!(?config)` leaked a live credential.
#[test]
fn a_key_never_prints_itself() {
    let key = CursorApiKey::parse(KEY).expect("well-formed key");
    let printed = format!("{key:?}");
    assert!(!printed.contains(KEY), "Debug leaked the key: {printed}");
    assert_eq!(printed, "CursorApiKey(redacted)");
}

/// A KMS that enforces the one rule that matters: the context on decrypt must
/// equal the context on encrypt.
#[derive(Clone, Default)]
struct FakeKms {
    contexts: Arc<Mutex<Vec<HashMap<String, String>>>>,
    /// Ciphertext → (context, plaintext).
    stored: Arc<Mutex<Vec<(Vec<u8>, HashMap<String, String>, Vec<u8>)>>>,
}

impl FakeKms {
    /// The ciphertext a planted plaintext is addressed by.
    const PLANTED: &'static [u8] = b"planted-ciphertext";

    /// Pre-store a plaintext so a decrypt path can be tested directly.
    fn plant(&self, owner: &str, plaintext: &[u8]) {
        let context = KeyOwner::new(owner)
            .expect("test owner is usable")
            .encryption_context();
        self.stored.lock().expect("fake kms poisoned").push((
            Self::PLANTED.to_vec(),
            context,
            plaintext.to_vec(),
        ));
    }

    fn contexts(&self) -> Vec<HashMap<String, String>> {
        self.contexts.lock().expect("fake kms poisoned").clone()
    }
}

#[async_trait::async_trait]
impl KmsCiphertexts for FakeKms {
    async fn encrypt(
        &self,
        encryption_context: HashMap<String, String>,
        plaintext: &[u8],
    ) -> Result<(Vec<u8>, String), KmsCiphertextsError> {
        self.contexts
            .lock()
            .expect("fake kms poisoned")
            .push(encryption_context.clone());
        let mut stored = self.stored.lock().expect("fake kms poisoned");
        // Distinct per call, so a test cannot pass by two ciphertexts colliding.
        let ciphertext = format!("ciphertext-{}", stored.len()).into_bytes();
        stored.push((ciphertext.clone(), encryption_context, plaintext.to_vec()));
        Ok((ciphertext, "fake-kms-key".to_owned()))
    }

    async fn decrypt(
        &self,
        _kms_key_id: &str,
        ciphertext: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, KmsCiphertextsError> {
        self.contexts
            .lock()
            .expect("fake kms poisoned")
            .push(encryption_context.clone());
        self.stored
            .lock()
            .expect("fake kms poisoned")
            .iter()
            .find(|(stored_ciphertext, stored_context, _)| {
                stored_ciphertext == ciphertext && *stored_context == encryption_context
            })
            .map(|(_, _, plaintext)| Zeroizing::new(plaintext.clone()))
            // What KMS does when the context does not match.
            .ok_or(KmsCiphertextsError)
    }
}
