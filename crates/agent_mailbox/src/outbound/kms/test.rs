use std::sync::Mutex;

use macro_user_id::cowlike::CowLike;
use uuid::Uuid;

use super::*;

/// Stores ciphertexts with the context they were made under, refusing a
/// decrypt under any other context, as KMS does.
#[derive(Default)]
struct FakeKms {
    sealed: Mutex<Vec<Sealed>>,
}

/// One ciphertext, the context it was made under, and its plaintext.
type Sealed = (Vec<u8>, HashMap<String, String>, Vec<u8>);

impl MailboxKms for FakeKms {
    async fn encrypt(
        &self,
        encryption_context: HashMap<String, String>,
        plaintext: &[u8],
    ) -> Result<(Vec<u8>, String), MailboxKmsError> {
        let mut sealed = self.sealed.lock().unwrap();
        let ciphertext = vec![u8::try_from(sealed.len()).unwrap()];
        sealed.push((ciphertext.clone(), encryption_context, plaintext.to_vec()));
        Ok((ciphertext, "arn:aws:kms:local:key/agent-mailbox".to_owned()))
    }

    async fn decrypt(
        &self,
        _kms_key_id: &str,
        ciphertext: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, MailboxKmsError> {
        let sealed = self.sealed.lock().unwrap();
        sealed
            .iter()
            .find(|(stored, context, _)| stored == ciphertext && context == &encryption_context)
            .map(|(_, _, plaintext)| Zeroizing::new(plaintext.clone()))
            .ok_or(MailboxKmsError)
    }
}

fn agent(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

#[tokio::test]
async fn a_credential_decrypts_only_for_its_own_mailbox_and_agent() {
    let cipher = KmsMailboxKeyCipher::new(FakeKms::default());
    let mailbox = AgentMailboxId(Uuid::from_u128(1));
    let other_mailbox = AgentMailboxId(Uuid::from_u128(2));
    let ada = agent("macro|ada-1@agents.macro.invalid");
    let ben = agent("macro|ben-2@agents.macro.invalid");

    let encrypted = cipher
        .encrypt(mailbox, &ada, &MailboxKey::new("dse_scoped".to_owned()))
        .await
        .unwrap();

    assert_eq!(
        cipher
            .decrypt(mailbox, &ada, &encrypted)
            .await
            .unwrap()
            .expose(),
        "dse_scoped"
    );
    assert!(
        cipher
            .decrypt(other_mailbox, &ada, &encrypted)
            .await
            .is_err()
    );
    assert!(cipher.decrypt(mailbox, &ben, &encrypted).await.is_err());
}

#[tokio::test]
async fn an_unknown_encryption_version_is_refused_before_kms() {
    let cipher = KmsMailboxKeyCipher::new(FakeKms::default());
    let mailbox = AgentMailboxId(Uuid::from_u128(1));
    let ada = agent("macro|ada-1@agents.macro.invalid");
    let mut encrypted = cipher
        .encrypt(mailbox, &ada, &MailboxKey::new("dse_scoped".to_owned()))
        .await
        .unwrap();
    encrypted.encryption_version = 2;

    let result = cipher.decrypt(mailbox, &ada, &encrypted).await;

    assert!(matches!(
        result,
        Err(MailboxKeyCipherError::UnsupportedVersion(2))
    ));
}

#[test]
fn every_kms_call_gives_up_inside_the_mailbox_lease() {
    let client = aws_sdk_kms::Client::from_conf(
        aws_sdk_kms::Config::builder()
            .behavior_version(aws_sdk_kms::config::BehaviorVersion::latest())
            .region(aws_sdk_kms::config::Region::new("us-east-1"))
            .build(),
    );

    let kms = AwsMailboxKms::new(client, "alias/agent-mailbox".to_owned());

    let timeout = kms
        .client
        .config()
        .timeout_config()
        .and_then(|timeouts| timeouts.operation_timeout());
    assert_eq!(timeout, Some(KMS_CALL_TIMEOUT));
    assert!(
        KMS_CALL_TIMEOUT.as_secs() * 6 < 180,
        "a step's calls fit in LEASE_TTL"
    );
}
