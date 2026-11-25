use super::*;

/// RFC 7636, Appendix B.
const RFC_VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE: &str = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

#[test]
fn the_challenge_of_a_verifier_matches_rfc_7636() {
    let verifier = CodeVerifier::parse(RFC_VERIFIER.into()).unwrap();
    assert_eq!(CodeChallenge::of(&verifier).as_str(), RFC_CHALLENGE);
    assert_eq!(
        CodeChallenge::parse(RFC_CHALLENGE).unwrap(),
        CodeChallenge::of(&verifier)
    );
}

#[test]
fn a_challenge_must_be_a_sha256_digest() {
    for invalid in [
        "",
        "short",
        // Padded, standard alphabet, and one character too long.
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM=",
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM",
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cMA",
    ] {
        assert!(CodeChallenge::parse(invalid).is_err(), "{invalid:?}");
    }
}

#[test]
fn a_verifier_must_be_long_and_unreserved() {
    for invalid in [
        "a".repeat(42),
        "a".repeat(129),
        format!("{}!", "a".repeat(43)),
    ] {
        assert!(CodeVerifier::parse(invalid.clone()).is_err(), "{invalid:?}");
    }
    assert!(CodeVerifier::parse("a".repeat(43)).is_ok());
    assert!(CodeVerifier::parse("A-._~".repeat(20)).is_ok());
}

#[test]
fn debug_output_never_shows_the_verifier() {
    let verifier = CodeVerifier::parse(RFC_VERIFIER.into()).unwrap();
    assert!(!format!("{verifier:?}").contains(RFC_VERIFIER));
}
