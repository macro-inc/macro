use super::RowCipher;
use uuid::Uuid;

#[test]
fn a_secret_opens_only_in_its_own_row_under_its_own_key() {
    let cipher = RowCipher::new(&[7; 32]);
    let row = Uuid::from_u128(1);
    let sealed = cipher.seal(row, b"whsec_secret").unwrap();

    assert_eq!(cipher.open(row, &sealed).unwrap(), b"whsec_secret");
    assert!(cipher.open(Uuid::from_u128(2), &sealed).is_err());
    assert!(RowCipher::new(&[8; 32]).open(row, &sealed).is_err());
    assert!(cipher.open(row, &sealed[..11]).is_err());
}

#[test]
fn secrets_granola_stored_before_this_crate_still_open() {
    use aes_gcm::{
        Aes256Gcm, KeyInit,
        aead::{Aead, Payload},
    };
    // The format Granola wrote: a 12-byte nonce, then AES-256-GCM over the
    // secret with the row id as additional data.
    let key = [7; 32];
    let row = Uuid::from_u128(1);
    let nonce = [3; 12];
    let ciphertext = Aes256Gcm::new(&key.into())
        .encrypt(
            &nonce.into(),
            Payload {
                msg: b"whsec_secret",
                aad: row.as_bytes(),
            },
        )
        .unwrap();
    let stored = [&nonce[..], &ciphertext].concat();

    assert_eq!(
        RowCipher::new(&key).open(row, &stored).unwrap(),
        b"whsec_secret"
    );
}
