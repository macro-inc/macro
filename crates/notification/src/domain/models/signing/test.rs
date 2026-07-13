use super::*;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use url::Url;

fn make_secret(key: &[u8]) -> Hmac<Sha256> {
    Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts any key size")
}

#[test]
fn sign_and_verify_roundtrip() {
    let secret = make_secret(b"test-secret");
    let url = Url::parse("https://example.com/path?foo=bar").unwrap();
    let signed = SignedUrl::new(url, secret.clone());

    let signed_url: &Url = signed.as_ref();
    assert!(signed_url.as_str().contains("sig="));
    assert!(SignedUrl::verify(signed_url.clone(), secret).is_some());
}

#[test]
fn verify_rejects_tampered_sig() {
    let secret = make_secret(b"test-secret");
    let url = Url::parse("https://example.com/path").unwrap();
    let signed = SignedUrl::new(url, secret.clone());

    let mut tampered: Url = signed.as_ref().clone();
    tampered.set_query(Some("sig=deadbeef"));
    assert!(SignedUrl::verify(tampered, secret).is_none());
}

#[test]
fn verify_rejects_wrong_secret() {
    let secret = make_secret(b"test-secret");
    let wrong = make_secret(b"wrong-secret");
    let url = Url::parse("https://example.com/path").unwrap();
    let signed = SignedUrl::new(url, secret);

    assert!(SignedUrl::verify(signed.as_ref().clone(), wrong).is_none());
}

#[test]
fn verify_returns_none_when_no_sig_param() {
    let secret = make_secret(b"test-secret");
    let url = Url::parse("https://example.com/path").unwrap();
    assert!(SignedUrl::verify(url, secret).is_none());
}
