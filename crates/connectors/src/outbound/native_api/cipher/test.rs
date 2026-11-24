use super::*;
use macro_user_id::cowlike::CowLike as _;
use std::sync::Mutex;

/// KMS as the cipher sees it: one local master key that wraps data keys by
/// XOR, refusing a context that differs from the one a key was made under.
#[derive(Default)]
pub(crate) struct FakeDataKeys {
    issued: Mutex<Vec<Issued>>,
}

/// A wrapped data key and the context it was made under.
type Issued = (Vec<u8>, HashMap<String, String>);

pub(crate) const FAKE_KEY_ID: &str = "arn:aws:kms:us-east-1:000000000000:key/fake";

#[async_trait::async_trait]
impl DataKeys for FakeDataKeys {
    async fn generate(&self, context: HashMap<String, String>) -> Result<DataKey, Report> {
        let mut issued = self.issued.lock().unwrap();
        let index = u8::try_from(issued.len()).unwrap();
        let plaintext = vec![index.wrapping_add(1); KEY_BYTES];
        let encrypted = plaintext.iter().map(|byte| byte ^ 0x5a).collect::<Vec<_>>();
        issued.push((encrypted.clone(), context));

        Ok(DataKey {
            plaintext: Zeroizing::new(plaintext),
            encrypted,
            key_id: FAKE_KEY_ID.to_owned(),
        })
    }

    async fn decrypt(
        &self,
        kms_key_id: &str,
        encrypted: &[u8],
        context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, Report> {
        let issued = self.issued.lock().unwrap();
        let matches = kms_key_id == FAKE_KEY_ID
            && issued
                .iter()
                .any(|(key, made_under)| key == encrypted && *made_under == context);
        if !matches {
            return Err(rootcause::report!("InvalidCiphertextException"));
        }

        Ok(Zeroizing::new(
            encrypted.iter().map(|byte| byte ^ 0x5a).collect(),
        ))
    }
}

pub(crate) fn fake_cipher() -> GrantCipher {
    GrantCipher::new(Arc::new(FakeDataKeys::default()))
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

fn grant() -> Grant {
    Grant {
        access_token: Zeroizing::new("access-1".to_owned()),
        refresh_token: Zeroizing::new("refresh-1".to_owned()),
    }
}

fn autodesk() -> ConnectorId {
    ConnectorId::parse("autodesk").unwrap()
}

#[tokio::test]
async fn a_sealed_grant_opens_for_its_own_user_and_app() {
    let cipher = fake_cipher();
    let owner = user("macro|owner@example.com");

    let sealed = cipher.encrypt(&owner, &autodesk(), &grant()).await.unwrap();
    assert_eq!(sealed.encryption_version, ENCRYPTION_VERSION);
    assert_eq!(sealed.kms_key_id, FAKE_KEY_ID);
    assert!(
        !sealed
            .ciphertext
            .windows(8)
            .any(|window| window == b"access-1")
    );

    let opened = cipher.decrypt(&owner, &autodesk(), &sealed).await.unwrap();
    assert_eq!(opened.access_token.as_str(), "access-1");
    assert_eq!(opened.refresh_token.as_str(), "refresh-1");
}

#[tokio::test]
async fn a_grant_copied_to_another_user_or_app_does_not_open() {
    let cipher = fake_cipher();
    let owner = user("macro|owner@example.com");
    let sealed = cipher.encrypt(&owner, &autodesk(), &grant()).await.unwrap();

    let other_user = user("macro|other@example.com");
    assert!(
        cipher
            .decrypt(&other_user, &autodesk(), &sealed)
            .await
            .is_err()
    );
    let other_app = ConnectorId::parse("notion").unwrap();
    assert!(cipher.decrypt(&owner, &other_app, &sealed).await.is_err());
}

#[tokio::test]
async fn a_tampered_envelope_does_not_open() {
    let cipher = fake_cipher();
    let owner = user("macro|owner@example.com");
    let sealed = cipher.encrypt(&owner, &autodesk(), &grant()).await.unwrap();

    let mut flipped = sealed.clone();
    flipped.ciphertext[0] ^= 1;
    assert!(cipher.decrypt(&owner, &autodesk(), &flipped).await.is_err());

    let mut future = sealed;
    future.encryption_version = ENCRYPTION_VERSION + 1;
    assert!(cipher.decrypt(&owner, &autodesk(), &future).await.is_err());
}

#[test]
fn the_context_names_purpose_user_and_app() {
    let owner = user("macro|owner@example.com");
    let context = context(&owner, &autodesk());

    assert_eq!(context["macro:purpose"], ENCRYPTION_PURPOSE);
    assert_eq!(context["macro:user-id"], "macro|owner@example.com");
    assert_eq!(context["macro:app"], "autodesk");
}

#[test]
fn a_grant_never_prints_its_tokens() {
    assert_eq!(format!("{:?}", grant()), "Grant(<redacted>)");
}
