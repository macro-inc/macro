use std::collections::HashMap;

use super::*;

#[test]
fn the_encryption_context_names_the_purpose_version_and_fields() {
    assert_eq!(
        encryption_context(
            "slack-session",
            1,
            &[
                ("user-id", "macro|alice"),
                ("account-id", "00000000-0000-0000-0000-000000000001")
            ]
        ),
        HashMap::from([
            ("macro:purpose".to_owned(), "slack-session".to_owned()),
            ("macro:encryption-version".to_owned(), "1".to_owned()),
            ("macro:user-id".to_owned(), "macro|alice".to_owned()),
            (
                "macro:account-id".to_owned(),
                "00000000-0000-0000-0000-000000000001".to_owned()
            ),
        ])
    );
}

#[tokio::test]
async fn the_fake_unwraps_only_under_the_same_context_and_key() {
    let kms = FakeKms::new("key-1");
    let context = encryption_context("purpose", 1, &[("user-id", "macro|alice")]);
    let generated = kms.generate_data_key(context.clone()).await.unwrap();
    assert_eq!(generated.plaintext.len(), 32);
    assert_eq!(generated.kms_key_id, "key-1");

    let unwrapped = kms
        .decrypt("key-1", &generated.ciphertext, context.clone())
        .await
        .unwrap();
    assert_eq!(*unwrapped, *generated.plaintext);

    for wrong_context in [
        encryption_context("purpose", 1, &[("user-id", "macro|bob")]),
        encryption_context("other-purpose", 1, &[("user-id", "macro|alice")]),
        encryption_context("purpose", 2, &[("user-id", "macro|alice")]),
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
        FakeKms::new("key-1")
            .decrypt("key-1", &generated.ciphertext, context)
            .await
            .is_err()
    );
    assert_eq!((kms.generate_calls(), kms.decrypt_calls()), (1, 5));
}
