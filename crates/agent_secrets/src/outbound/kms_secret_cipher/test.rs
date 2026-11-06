use std::sync::Mutex;

use cursor_api_key::cipher::KmsCiphertextsError;
use macro_user_id::cowlike::CowLike;
use zeroize::Zeroizing;

use super::*;

/// A KMS that, like the real one, refuses a decrypt whose context differs
/// from the one the ciphertext was encrypted under.
#[derive(Default)]
struct FakeKms {
    stored: Mutex<Vec<(Vec<u8>, HashMap<String, String>, Vec<u8>)>>,
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

#[tokio::test]
async fn a_secret_decrypts_only_for_its_agent_and_name() {
    let cipher = KmsSecretCipher::new(FakeKms::default());
    let sam = MacroUserIdStr::parse_from_str("macro|sam@example.com")
        .expect("user id")
        .into_owned();
    let bob = MacroUserIdStr::parse_from_str("macro|bob@example.com")
        .expect("user id")
        .into_owned();
    let github = SecretName::parse("github-token").expect("name");
    let linear = SecretName::parse("linear-token").expect("name");
    let value = SecretValue::parse("ghp_abc".to_string()).expect("value");

    let encrypted = cipher
        .encrypt(&sam, &github, &value)
        .await
        .expect("encrypted");
    assert_eq!(encrypted.encryption_version, 1);
    assert_eq!(encrypted.kms_key_id.as_str(), "fake-kms-key");

    let decrypted = cipher
        .decrypt(&sam, &github, &encrypted)
        .await
        .expect("its own agent and name decrypt it");
    assert_eq!(decrypted.expose(), "ghp_abc");

    assert!(
        cipher.decrypt(&bob, &github, &encrypted).await.is_err(),
        "a row moved to another agent must not decrypt"
    );
    assert!(
        cipher.decrypt(&sam, &linear, &encrypted).await.is_err(),
        "a row renamed must not decrypt"
    );
}

#[tokio::test]
async fn an_unknown_encryption_version_is_refused() {
    let cipher = KmsSecretCipher::new(FakeKms::default());
    let sam = MacroUserIdStr::parse_from_str("macro|sam@example.com")
        .expect("user id")
        .into_owned();
    let name = SecretName::parse("github-token").expect("name");
    let mut encrypted = cipher
        .encrypt(
            &sam,
            &name,
            &SecretValue::parse("ghp_abc".to_string()).expect("value"),
        )
        .await
        .expect("encrypted");
    encrypted.encryption_version = 2;

    assert!(cipher.decrypt(&sam, &name, &encrypted).await.is_err());
}
