use super::*;

#[test]
fn generated_secret_round_trips_through_parse() {
    let binding = BrowserBinding::generate();

    assert_eq!(BrowserBinding::parse(binding.as_str()), Some(binding));
}

#[test]
fn parse_refuses_a_secret_of_the_wrong_length() {
    assert_eq!(BrowserBinding::parse("c2hvcnQ"), None);
    assert_eq!(BrowserBinding::parse(""), None);
}

#[test]
fn parse_refuses_text_that_is_not_base64url() {
    assert_eq!(
        BrowserBinding::parse("not base64 at all, and long enough to look like a secret!"),
        None
    );
}

#[test]
fn digest_matches_only_its_own_secret() {
    let binding = BrowserBinding::generate();
    let other = BrowserBinding::generate();

    assert!(binding.matches_digest(&binding.digest()));
    assert!(!other.matches_digest(&binding.digest()));
}

#[test]
fn consent_token_is_accepted_only_for_its_own_secret() {
    let binding = BrowserBinding::generate();
    let other = BrowserBinding::generate();

    assert!(binding.accepts_consent_token(&binding.consent_token()));
    assert!(!other.accepts_consent_token(&binding.consent_token()));
    assert!(!binding.accepts_consent_token(""));
}

#[test]
fn consent_token_is_not_the_stored_digest() {
    let binding = BrowserBinding::generate();

    assert!(!binding.accepts_consent_token(&binding.digest()));
    assert!(!binding.matches_digest(&binding.consent_token()));
}
