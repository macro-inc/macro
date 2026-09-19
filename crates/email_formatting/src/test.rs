use super::*;
use hmac::Mac;
use sha2::Sha256;

#[test]
fn unsubscribe_url_keeps_gateway_prefix() {
    let url = signing::append_path(
        NotificationServiceUrl::default_for_environment(Environment::Production)
            .parse_url()
            .unwrap(),
        "/user_notifications/preferences/email-digest-notification/disable",
    );
    assert_eq!(
        url.as_str(),
        "https://gateway.macro.com/notification/user_notifications/preferences/email-digest-notification/disable"
    );
}

#[test]
fn signed_unsubscribe_roundtrips_against_request_url() {
    let secret = Hmac::<Sha256>::new_from_slice(b"test-secret").unwrap();
    let mut unsigned = signing::append_path(
        NotificationServiceUrl::default_for_environment(Environment::Production)
            .parse_url()
            .unwrap(),
        "/user_notifications/preferences/email-digest-notification/disable",
    );
    unsigned
        .query_pairs_mut()
        .append_pair("id", "macro|user@example.com");
    let signed = SignedUrl::new(unsigned, secret.clone());

    let reconstructed =
        signing::public_request_url("https", "gateway.macro.com", signed.as_ref().path()).unwrap();
    let mut to_verify = reconstructed;
    to_verify.set_query(signed.as_ref().query());

    assert!(SignedUrl::verify(to_verify, secret).is_some());
    assert!(
        signed
            .as_ref()
            .as_str()
            .contains("/notification/user_notifications/")
    );
}
