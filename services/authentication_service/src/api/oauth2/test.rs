use super::*;

#[test]
fn callback_original_url_allows_trusted_destinations() {
    for original_url in [
        "macro://login",
        "tauri://localhost/app/login",
        "http://localhost/app/login",
        "https://dev.macro.com/app/login",
        "https://macro.com/app/login",
    ] {
        assert!(
            validate_original_url(Some(original_url)).is_ok(),
            "{original_url} should be allowed"
        );
    }
}

#[test]
fn callback_original_url_rejects_untrusted_destinations() {
    for original_url in [
        "https://evil.example.com/phish",
        "https://macro.com.example.com/phish",
        "http://macro.com/phish",
        "javascript:alert('redirected')",
    ] {
        assert!(
            matches!(
                validate_original_url(Some(original_url)),
                Err(OriginalUrlValidationError::Disallowed(_))
            ),
            "{original_url} should be rejected"
        );
    }
}

#[test]
fn callback_original_url_validates_decoded_destination() {
    let encoded_url = urlencoding::encode("https://evil.example.com/phish");

    assert!(matches!(
        validate_original_url(Some(&encoded_url)),
        Err(OriginalUrlValidationError::Disallowed(_))
    ));
}

#[test]
fn callback_original_url_rejects_invalid_urls() {
    assert!(matches!(
        validate_original_url(Some("%ZZ")),
        Err(OriginalUrlValidationError::Invalid)
    ));
    assert!(validate_original_url(None).is_ok());
}
