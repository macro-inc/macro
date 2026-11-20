use super::*;
use cursor_api_key::cipher::KmsCiphertextsError;
use std::sync::Mutex;
use zeroize::Zeroizing;

/// Each encryption: the ciphertext, its context and the plaintext.
type Stored = Mutex<Vec<(Vec<u8>, HashMap<String, String>, Vec<u8>)>>;

/// A KMS that, like the real one, refuses a decrypt whose context differs
/// from the one the ciphertext was encrypted under.
#[derive(Default)]
struct FakeKms {
    stored: Stored,
}

#[async_trait::async_trait]
impl KmsCiphertexts for FakeKms {
    async fn encrypt(
        &self,
        encryption_context: HashMap<String, String>,
        plaintext: &[u8],
    ) -> Result<(Vec<u8>, String), KmsCiphertextsError> {
        let mut stored = self.stored.lock().expect("lock");
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
        self.stored
            .lock()
            .expect("lock")
            .iter()
            .find(|(stored, context, _)| stored == ciphertext && *context == encryption_context)
            .map(|(_, _, plaintext)| Zeroizing::new(plaintext.clone()))
            .ok_or(KmsCiphertextsError)
    }
}

const SECRET: &str = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).expect("valid user id")
}

#[tokio::test]
async fn a_secret_decrypts_only_for_its_subscriber() {
    let cipher = KmsMcpSecretCipher::new(FakeKms::default());
    let me = user("macro|me@example.com");
    let secret = SigningSecret::parse(SECRET).expect("valid secret");
    let encrypted = cipher.encrypt(&me, &secret).await.expect("encrypted");
    assert_eq!(encrypted.kms_key_id, "fake-kms-key");
    assert_eq!(encrypted.encryption_version, ENCRYPTION_VERSION);

    let decrypted = cipher.decrypt(&me, &encrypted).await.expect("decrypts");
    assert_eq!(decrypted.expose().as_str(), SECRET);

    assert!(
        cipher
            .decrypt(&user("macro|other@example.com"), &encrypted)
            .await
            .is_err(),
        "a row moved to another user must not decrypt"
    );
}

#[tokio::test]
async fn an_unknown_scheme_is_refused() {
    let cipher = KmsMcpSecretCipher::new(FakeKms::default());
    let me = user("macro|me@example.com");
    let secret = SigningSecret::parse(SECRET).expect("valid secret");
    let mut encrypted = cipher.encrypt(&me, &secret).await.expect("encrypted");
    encrypted.encryption_version = ENCRYPTION_VERSION + 1;
    assert!(cipher.decrypt(&me, &encrypted).await.is_err());
}
