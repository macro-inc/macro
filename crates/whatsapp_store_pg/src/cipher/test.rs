use uuid::Uuid;

use super::*;

const ACCOUNT: Uuid = Uuid::from_u128(1);
const OTHER_ACCOUNT: Uuid = Uuid::from_u128(2);

fn cipher(account_id: Uuid) -> ValueCipher {
    ValueCipher::new(
        account_id,
        &WhatsAppDataKey::from_plaintext(&[42; 32]).unwrap(),
    )
}

#[test]
fn a_sealed_value_opens_only_under_its_account_store_and_key() {
    let sealed = cipher(ACCOUNT)
        .seal(StoreName::Session, &[b"111:0"], b"session")
        .unwrap();

    assert_eq!(
        cipher(ACCOUNT)
            .open(
                StoreName::Session,
                &[b"111:0"],
                &sealed.nonce,
                &sealed.value
            )
            .unwrap(),
        b"session"
    );
    for (account, store, key) in [
        (OTHER_ACCOUNT, StoreName::Session, b"111:0".as_slice()),
        (ACCOUNT, StoreName::Identity, b"111:0".as_slice()),
        (ACCOUNT, StoreName::Session, b"111:1".as_slice()),
    ] {
        assert!(matches!(
            cipher(account).open(store, &[key], &sealed.nonce, &sealed.value),
            Err(WhatsAppStoreError::Decrypt)
        ));
    }
}
