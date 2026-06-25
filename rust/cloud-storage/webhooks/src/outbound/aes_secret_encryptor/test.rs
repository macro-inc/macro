use super::*;

fn encryptor() -> AesSecretEncryptor {
    AesSecretEncryptor::new([7u8; 32])
}

#[test]
fn generated_secret_has_prefix_and_length() {
    let secret = encryptor().generate_secret();
    assert!(secret.starts_with(SECRET_PREFIX));
    assert_eq!(secret.len(), SECRET_PREFIX.len() + SECRET_RANDOM_LEN);
}

#[test]
fn encrypt_then_decrypt_roundtrips() {
    let enc = encryptor();
    let plaintext = b"super-secret-signing-key";
    let ciphertext = enc.encrypt(plaintext).unwrap();
    assert_ne!(ciphertext.as_slice(), plaintext);
    assert_eq!(enc.decrypt(&ciphertext).unwrap(), plaintext);
}

#[test]
fn decrypt_rejects_wrong_key() {
    let ciphertext = encryptor().encrypt(b"data").unwrap();
    let other = AesSecretEncryptor::new([9u8; 32]);
    assert!(other.decrypt(&ciphertext).is_err());
}

#[test]
fn decrypt_rejects_truncated_input() {
    assert!(encryptor().decrypt(b"short").is_err());
}
