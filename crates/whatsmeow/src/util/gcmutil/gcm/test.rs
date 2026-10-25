// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Expected values were produced by whatsmeow's Go code at the pinned revision.

use super::*;

#[test]
fn encrypt_matches_go_and_decrypts_back() {
    let key: Vec<u8> = (0x40..0x60).collect();
    let iv: Vec<u8> = (0x80..0x8c).collect();
    let ciphertext = encrypt(&key, &iv, b"hello whatsmeow", b"aad").unwrap();
    assert_eq!(
        hex::encode(&ciphertext),
        "453bd2ab4d545deb091ee34517cde263305e7ba69bd1ef70560c63f3834543"
    );
    assert_eq!(
        decrypt(&key, &iv, &ciphertext, b"aad").unwrap(),
        b"hello whatsmeow"
    );
    assert_eq!(
        hex::encode(encrypt(&key, &iv, &[], &[]).unwrap()),
        "181bad459ada9d8a2a177dc184770f4c"
    );
}

#[test]
fn decrypt_rejects_tampering_and_bad_sizes() {
    let key: Vec<u8> = (0x40..0x60).collect();
    let iv: Vec<u8> = (0x80..0x8c).collect();
    let ciphertext = encrypt(&key, &iv, b"hello whatsmeow", b"aad").unwrap();
    assert_eq!(
        decrypt(&key, &iv, &ciphertext, b"other"),
        Err(GcmError::Authentication)
    );
    assert_eq!(
        decrypt(&key[..16], &iv, &ciphertext, b"aad"),
        Err(GcmError::InvalidKeySize(16))
    );
    assert_eq!(
        decrypt(&key, &iv[..8], &ciphertext, b"aad"),
        Err(GcmError::InvalidNonceSize(8))
    );
}
