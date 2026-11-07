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

#[test]
fn key_parts_are_length_prefixed_so_splits_differ() {
    let sealed = cipher(ACCOUNT)
        .seal(StoreName::MessageSecret, &[b"ab", b"c"], b"secret")
        .unwrap();
    assert!(
        cipher(ACCOUNT)
            .open(
                StoreName::MessageSecret,
                &[b"a", b"bc"],
                &sealed.nonce,
                &sealed.value
            )
            .is_err()
    );
    assert!(
        cipher(ACCOUNT)
            .open(
                StoreName::MessageSecret,
                &[b"abc"],
                &sealed.nonce,
                &sealed.value
            )
            .is_err()
    );
}

#[test]
fn another_data_key_or_a_tampered_value_does_not_open() {
    let sealed = cipher(ACCOUNT)
        .seal(StoreName::Session, &[b"111:0"], b"session")
        .unwrap();
    let other_key = ValueCipher::new(
        ACCOUNT,
        &WhatsAppDataKey::from_plaintext(&[43; 32]).unwrap(),
    );
    assert!(
        other_key
            .open(
                StoreName::Session,
                &[b"111:0"],
                &sealed.nonce,
                &sealed.value
            )
            .is_err()
    );

    let mut tampered = sealed.value.clone();
    tampered[0] ^= 1;
    assert!(
        cipher(ACCOUNT)
            .open(StoreName::Session, &[b"111:0"], &sealed.nonce, &tampered)
            .is_err()
    );
    assert!(
        cipher(ACCOUNT)
            .open(
                StoreName::Session,
                &[b"111:0"],
                &sealed.nonce[..11],
                &sealed.value
            )
            .is_err()
    );
}

#[test]
fn every_seal_uses_a_fresh_nonce() {
    let cipher = cipher(ACCOUNT);
    let first = cipher
        .seal(StoreName::Session, &[b"111:0"], b"same")
        .unwrap();
    let second = cipher
        .seal(StoreName::Session, &[b"111:0"], b"same")
        .unwrap();
    assert_eq!(first.nonce.len(), 12);
    assert_ne!(first.nonce, second.nonce);
    assert_ne!(first.value, second.value);
}

#[test]
fn the_data_key_is_32_bytes_and_never_printed() {
    assert!(matches!(
        WhatsAppDataKey::from_plaintext(&[1; 31]),
        Err(WhatsAppStoreError::Malformed)
    ));
    let key = WhatsAppDataKey::from_plaintext(&[0xab; 32]).unwrap();
    assert_eq!(format!("{key:?}"), "WhatsAppDataKey(redacted)");
}
