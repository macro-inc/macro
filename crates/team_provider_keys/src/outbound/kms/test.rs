use std::sync::Mutex;

use cursor_api_key::cipher::KmsCiphertextsError;
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
    ) -> std::result::Result<(Vec<u8>, String), KmsCiphertextsError> {
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
    ) -> std::result::Result<Zeroizing<Vec<u8>>, KmsCiphertextsError> {
        self.stored
            .lock()
            .expect("lock")
            .iter()
            .find(|(stored, context, _)| stored == ciphertext && *context == encryption_context)
            .map(|(_, _, plaintext)| Zeroizing::new(plaintext.clone()))
            .ok_or(KmsCiphertextsError)
    }
}

const TEAM: &str = "00000000-0000-0000-0000-0000000000aa";
const OTHER_TEAM: &str = "00000000-0000-0000-0000-0000000000bb";

#[tokio::test]
async fn a_key_decrypts_only_for_its_team_and_provider() {
    let cipher = KmsProviderKeyCipher::new(FakeKms::default());
    let team: Uuid = TEAM.parse().expect("uuid");
    let key = ProviderApiKey::parse(ModelProvider::Anthropic, "sk-ant-api03-abc").expect("valid");
    let encrypted = cipher.encrypt(team, &key).await.expect("encrypted");

    let decrypted = cipher
        .decrypt(team, ModelProvider::Anthropic, &encrypted)
        .await
        .expect("its own team decrypts it");
    assert_eq!(decrypted.expose(), "sk-ant-api03-abc");

    assert!(
        cipher
            .decrypt(
                OTHER_TEAM.parse().expect("uuid"),
                ModelProvider::Anthropic,
                &encrypted
            )
            .await
            .is_err(),
        "a row moved to another team must not decrypt"
    );
    assert!(
        cipher
            .decrypt(team, ModelProvider::OpenAi, &encrypted)
            .await
            .is_err(),
        "a row relabelled as another provider must not decrypt"
    );
}
