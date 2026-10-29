use uuid::Uuid;

use super::*;

const ACCOUNT: Uuid = Uuid::from_u128(1);

#[test]
fn the_encryption_context_names_the_purpose_user_account_and_version() {
    assert_eq!(
        encryption_context("macro|alice", ACCOUNT),
        HashMap::from([
            ("macro:purpose".to_owned(), "whatsapp-session".to_owned()),
            ("macro:user-id".to_owned(), "macro|alice".to_owned()),
            (
                "macro:account-id".to_owned(),
                "00000000-0000-0000-0000-000000000001".to_owned()
            ),
            ("macro:encryption-version".to_owned(), "1".to_owned()),
        ])
    );
}

#[tokio::test]
async fn the_fake_unwraps_only_under_the_same_context_and_key() {
    let kms = FakeWhatsAppKms::new("key-1");
    let context = encryption_context("macro|alice", ACCOUNT);
    let generated = kms.generate_data_key(context.clone()).await.unwrap();
    assert_eq!(generated.plaintext.len(), 32);
    assert_eq!(generated.kms_key_id, "key-1");

    let unwrapped = kms
        .decrypt("key-1", &generated.ciphertext, context.clone())
        .await
        .unwrap();
    assert_eq!(*unwrapped, *generated.plaintext);

    for wrong_context in [
        encryption_context("macro|bob", ACCOUNT),
        encryption_context("macro|alice", Uuid::from_u128(2)),
    ] {
        assert!(
            kms.decrypt("key-1", &generated.ciphertext, wrong_context)
                .await
                .is_err()
        );
    }
    assert!(
        kms.decrypt("key-2", &generated.ciphertext, context.clone())
            .await
            .is_err()
    );
    assert!(
        FakeWhatsAppKms::new("key-1")
            .decrypt("key-1", &generated.ciphertext, context)
            .await
            .is_err()
    );
    assert_eq!((kms.generate_calls(), kms.decrypt_calls()), (1, 4));
}

#[test]
fn a_generated_key_never_prints_its_plaintext() {
    let generated = GeneratedDataKey {
        plaintext: Zeroizing::new(vec![0xab; 32]),
        ciphertext: vec![1, 2, 3],
        kms_key_id: "key-1".to_owned(),
    };
    let printed = format!("{generated:?}");
    assert!(!printed.contains("171"), "{printed}");
    assert!(printed.contains("key-1"));
}
