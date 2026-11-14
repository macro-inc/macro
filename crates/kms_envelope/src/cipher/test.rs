use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use uuid::Uuid;

use super::*;

const SCOPE: Uuid = Uuid::from_u128(1);
const OTHER_SCOPE: Uuid = Uuid::from_u128(2);

fn cipher(scope: Uuid) -> ValueCipher {
    ValueCipher::new(scope, &DataKey::from_plaintext(&[42; 32]).unwrap())
}

#[test]
fn a_sealed_value_opens_only_under_its_scope_and_labels() {
    let sealed = cipher(SCOPE)
        .seal(&[b"session", b"111:0"], b"session")
        .unwrap();

    assert_eq!(
        cipher(SCOPE)
            .open(&[b"session", b"111:0"], &sealed.nonce, &sealed.value)
            .unwrap(),
        b"session"
    );
    for (scope, labels) in [
        (OTHER_SCOPE, [b"session".as_slice(), b"111:0".as_slice()]),
        (SCOPE, [b"identity".as_slice(), b"111:0".as_slice()]),
        (SCOPE, [b"session".as_slice(), b"111:1".as_slice()]),
    ] {
        assert_eq!(
            cipher(scope).open(&labels, &sealed.nonce, &sealed.value),
            Err(CipherError::Decrypt)
        );
    }
}

/// Stored ciphertexts depend on this exact layout: changing it makes every
/// sealed value unreadable.
#[test]
fn the_associated_data_is_the_scope_then_length_prefixed_labels() {
    let nonce = [7; NONCE_LENGTH];
    let associated_data = [
        SCOPE.as_bytes().as_slice(),
        &[0, 0, 0, 6],
        b"sealed",
        &[0, 0, 0, 7],
        b"locator",
    ]
    .concat();
    let value = Aes256Gcm::new(&[42; 32].into())
        .encrypt(
            &Nonce::from(nonce),
            Payload {
                msg: b"plaintext",
                aad: &associated_data,
            },
        )
        .unwrap();

    let blob = [&[0x01], nonce.as_slice(), &value].concat();
    assert_eq!(
        *cipher(SCOPE)
            .open_blob(&[b"sealed", b"locator"], &blob)
            .unwrap(),
        b"plaintext"
    );
}

#[test]
fn labels_are_length_prefixed_so_splits_differ() {
    let sealed = cipher(SCOPE).seal(&[b"ab", b"c"], b"secret").unwrap();
    for labels in [[b"a".as_slice(), b"bc".as_slice()].as_slice(), &[b"abc"]] {
        assert!(
            cipher(SCOPE)
                .open(labels, &sealed.nonce, &sealed.value)
                .is_err()
        );
    }
}

#[test]
fn another_data_key_or_a_tampered_value_does_not_open() {
    let sealed = cipher(SCOPE).seal(&[b"key"], b"value").unwrap();
    let other_key = ValueCipher::new(SCOPE, &DataKey::from_plaintext(&[43; 32]).unwrap());
    assert!(
        other_key
            .open(&[b"key"], &sealed.nonce, &sealed.value)
            .is_err()
    );

    let mut tampered = sealed.value.clone();
    tampered[0] ^= 1;
    assert!(
        cipher(SCOPE)
            .open(&[b"key"], &sealed.nonce, &tampered)
            .is_err()
    );
    assert!(
        cipher(SCOPE)
            .open(&[b"key"], &sealed.nonce[..11], &sealed.value)
            .is_err()
    );
}

#[test]
fn a_blob_opens_only_in_its_format_and_labels() {
    let blob = cipher(SCOPE).seal_blob(&[b"purpose"], b"value").unwrap();
    assert_eq!(blob[0], 0x01);
    assert_eq!(
        *cipher(SCOPE).open_blob(&[b"purpose"], &blob).unwrap(),
        b"value"
    );
    assert!(cipher(SCOPE).open_blob(&[b"other"], &blob).is_err());
    let mut wrong_format = blob.clone();
    wrong_format[0] = 0x02;
    assert!(
        cipher(SCOPE)
            .open_blob(&[b"purpose"], &wrong_format)
            .is_err()
    );
    assert!(cipher(SCOPE).open_blob(&[b"purpose"], &[]).is_err());
}

#[test]
fn every_seal_uses_a_fresh_nonce() {
    let cipher = cipher(SCOPE);
    let first = cipher.seal(&[b"key"], b"same").unwrap();
    let second = cipher.seal(&[b"key"], b"same").unwrap();
    assert_eq!(first.nonce.len(), 12);
    assert_ne!(first.nonce, second.nonce);
    assert_ne!(first.value, second.value);
}

#[test]
fn the_data_key_is_32_bytes_and_never_printed() {
    assert_eq!(
        DataKey::from_plaintext(&[1; 31]).unwrap_err(),
        CipherError::Malformed
    );
    let key = DataKey::from_plaintext(&[0xab; 32]).unwrap();
    assert_eq!(format!("{key:?}"), "DataKey(redacted)");
}
