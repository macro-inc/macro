// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Expected values were produced by whatsmeow's Go code at the pinned revision.

use std::io::Cursor;

use super::*;

#[test]
fn encrypt_matches_go_for_every_padding_length() {
    let key: Vec<u8> = (0x40..0x60).collect();
    let iv: Vec<u8> = (0x90..0xa0).collect();
    let cases = [
        (0, "f21da86a109ab406087a15d196c221ca"),
        (5, "a006058f4c46efee43e1943499029788"),
        (
            16,
            "b78f41d7ca2543b61d6b370dd1f94e583c7f117fc6c5d90d37ec4fa4eb949400",
        ),
        (
            33,
            "b78f41d7ca2543b61d6b370dd1f94e58f005ca3c5d58924d8b9170e2a3478072dd69d3b79e50ba8835da407b3d4abfce",
        ),
    ];
    for (length, expected) in cases {
        let plaintext: Vec<u8> = (0x10..0x10 + length).collect();
        let ciphertext = encrypt(&key, Some(&iv), &plaintext).unwrap();
        assert_eq!(hex::encode(&ciphertext), expected, "{length}");
        assert_eq!(decrypt(&key, &iv, &ciphertext).unwrap(), plaintext);
    }
}

#[test]
fn encrypt_without_iv_prepends_a_random_one() {
    let key: Vec<u8> = (0x40..0x60).collect();
    let ciphertext = encrypt(&key, None, b"app state").unwrap();
    assert_eq!(ciphertext.len(), 32);
    let (iv, ciphertext) = ciphertext.split_at(BLOCK_SIZE);
    assert_eq!(decrypt(&key, iv, ciphertext).unwrap(), b"app state");
}

#[test]
fn decrypt_unpads_as_leniently_as_go() {
    let key: Vec<u8> = (0x40..0x60).collect();
    let iv: Vec<u8> = (0x90..0xa0).collect();
    // A last byte of 0 removes nothing; Go doesn't validate the other padding bytes.
    let mut block = [3; 16];
    block[15] = 0;
    let ciphertext = encrypt(&key, Some(&iv), &block).unwrap();
    let decrypted_with_padding = decrypt(&key, &iv, &ciphertext).unwrap();
    assert_eq!(decrypted_with_padding, block);

    assert!(matches!(
        decrypt(&key, &iv, &ciphertext[..15]),
        Err(CbcError::NotBlockAligned(15))
    ));
    assert!(matches!(
        decrypt(&key, &iv, &[]),
        Err(CbcError::NotBlockAligned(0))
    ));
}

#[test]
fn encrypt_stream_matches_go() {
    let key: Vec<u8> = (0x40..0x60).collect();
    let iv: Vec<u8> = (0x90..0xa0).collect();
    let mac_key: Vec<u8> = (0xa0..0xc0).collect();
    // 33600 bytes, so the stream spans two read buffers.
    let plaintext = b"whatsmeow media ".repeat(2100);
    let mut output = Vec::new();
    let result = encrypt_stream(
        &key,
        &iv,
        &mac_key,
        &mut Cursor::new(&plaintext),
        &mut output,
    )
    .unwrap();

    assert_eq!(
        result,
        EncryptedStream {
            plaintext_sha256: hex::decode(
                "f86ecb52292f141f84d227ed410722f9eef5d77b6b207690c5490b1700f4d8ba"
            )
            .unwrap()
            .try_into()
            .unwrap(),
            ciphertext_sha256: hex::decode(
                "b0eb3872d3e97a983d104299a3c8d74901482d1f52e4a6984837fe5cdf6f1058"
            )
            .unwrap()
            .try_into()
            .unwrap(),
            plaintext_length: 33600,
            ciphertext_length: 33626,
        }
    );
    assert_eq!(output.len(), 33626);
    assert_eq!(
        hex::encode(&output[output.len() - 26..]),
        "72320d499cf9ee9c637d32319afcc2fe8f9bc59eda041a466022"
    );
    assert_eq!(
        output[..33616],
        encrypt(&key, Some(&iv), &plaintext).unwrap()
    );
}

#[test]
fn decrypt_file_decrypts_in_place_and_truncates_padding() {
    let key: Vec<u8> = (0x40..0x60).collect();
    let iv: Vec<u8> = (0x90..0xa0).collect();
    let plaintext = b"whatsmeow media ".repeat(2100);
    let mut file = tempfile::tempfile().unwrap();
    file.write_all(&encrypt(&key, Some(&iv), &plaintext).unwrap())
        .unwrap();

    decrypt_file(&key, &iv, &mut file).unwrap();

    assert_eq!(file.size().unwrap(), 33600);
    let mut decrypted = Vec::new();
    file.seek(SeekFrom::Start(0)).unwrap();
    file.read_to_end(&mut decrypted).unwrap();
    assert_eq!(decrypted, plaintext);
}
