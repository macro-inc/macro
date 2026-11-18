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

#[test]
fn append_path_keeps_gateway_prefix() {
    let base = Url::parse("https://gateway.macro.com/notification").unwrap();
    let joined = append_path(
        base,
        "/user_notifications/preferences/email-digest-notification/disable",
    );
    assert_eq!(
        joined.as_str(),
        "https://gateway.macro.com/notification/user_notifications/preferences/email-digest-notification/disable"
    );
}

#[test]
fn append_path_on_host_only_base_matches_legacy_route() {
    let base = Url::parse("https://notifications.macro.com").unwrap();
    let joined = append_path(
        base,
        "/user_notifications/preferences/email-digest-notification/disable",
    );
    assert_eq!(
        joined.as_str(),
        "https://notifications.macro.com/user_notifications/preferences/email-digest-notification/disable"
    );
}

#[test]
fn set_path_and_join_drop_gateway_prefix() {
    let mut set_path_url = Url::parse("https://gateway.macro.com/notification").unwrap();
    set_path_url.set_path("/user_notifications/preferences/x/disable");
    assert_eq!(
        set_path_url.as_str(),
        "https://gateway.macro.com/user_notifications/preferences/x/disable"
    );

    let joined = Url::parse("https://gateway.macro.com/notification")
        .unwrap()
        .join("/user_notifications/preferences/x/disable")
        .unwrap();
    assert_eq!(
        joined.as_str(),
        "https://gateway.macro.com/user_notifications/preferences/x/disable"
    );
}

#[test]
fn public_request_url_uses_request_host_and_full_path() {
    let legacy = public_request_url(
        "https",
        "notifications.macro.com",
        "/user_notifications/preferences/x/disable?id=macro%7Cuser",
    )
    .unwrap();
    assert_eq!(
        legacy.as_str(),
        "https://notifications.macro.com/user_notifications/preferences/x/disable?id=macro%7Cuser"
    );

    let gateway = public_request_url(
        "https",
        "gateway.macro.com",
        "/notification/user_notifications/preferences/x/disable?id=macro%7Cuser",
    )
    .unwrap();
    assert_eq!(
        gateway.as_str(),
        "https://gateway.macro.com/notification/user_notifications/preferences/x/disable?id=macro%7Cuser"
    );
}

#[test]
fn signed_url_roundtrips_on_both_public_hosts() {
    let secret = make_secret(b"test-secret");
    for raw in [
        "https://notifications.macro.com/user_notifications/preferences/x/disable?id=u",
        "https://gateway.macro.com/notification/user_notifications/preferences/x/disable?id=u",
    ] {
        let signed = SignedUrl::new(Url::parse(raw).unwrap(), secret.clone());
        assert!(SignedUrl::verify(signed.as_ref().clone(), secret.clone()).is_some());
    }
}

#[test]
fn unsubscribe_placeholders_become_signed_links_for_the_recipient() {
    let secret = make_secret(b"test-secret");
    let base = Url::parse("https://notifications.example.com").unwrap();
    let body = format!(
        "<a href=\"{}\">Unsubscribe</a>",
        unsubscribe_placeholder("colleague_joined_macro")
    );

    let signed = sign_unsubscribe_placeholders(&body, &base, "macro|bob@acme.com", &secret)
        .expect("the body has a placeholder");

    assert!(!signed.contains(UNSUBSCRIBE_PLACEHOLDER_PREFIX));
    let href = signed
        .strip_prefix("<a href=\"")
        .and_then(|s| s.split('"').next())
        .unwrap()
        .replace("&amp;", "&");
    let url = Url::parse(&href).unwrap();
    assert_eq!(
        url.path(),
        "/user_notifications/preferences/colleague_joined_macro/disable"
    );
    assert!(
        url.query_pairs()
            .any(|(k, v)| k == "id" && v == "macro|bob@acme.com")
    );
    assert!(SignedUrl::verify(url, secret).is_some());
}

#[test]
fn bodies_without_a_placeholder_are_left_alone() {
    let secret = make_secret(b"test-secret");
    let base = Url::parse("https://notifications.example.com").unwrap();
    assert!(sign_unsubscribe_placeholders("<p>hi</p>", &base, "macro|a@b.com", &secret).is_none());
}

#[test]
fn hyphenated_type_names_are_signed_whole() {
    let secret = make_secret(b"test-secret");
    let base = Url::parse("https://notifications.example.com").unwrap();
    let body = format!(
        "<a href=\"{}\">x</a>",
        unsubscribe_placeholder("email-digest-notification")
    );

    let signed = sign_unsubscribe_placeholders(&body, &base, "macro|a@b.com", &secret).unwrap();

    assert!(signed.contains("/preferences/email-digest-notification/disable"));
}
