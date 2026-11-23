use super::*;

/// RFC 7636 appendix B: this verifier's S256 challenge.
const RFC_VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE: &str = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

fn verifier(value: &str) -> SessionCodeVerifier {
    SessionCodeVerifier::try_from(value.to_owned()).unwrap()
}

#[test]
fn the_rfc_verifier_answers_its_challenge() {
    let verifier = verifier(RFC_VERIFIER);
    assert_eq!(SessionCodeChallenge::of(&verifier).as_str(), RFC_CHALLENGE);
    assert!(verifier.answers(RFC_CHALLENGE));
    let other = verifier.0.replace('d', "e");
    assert!(
        !SessionCodeVerifier::try_from(other)
            .unwrap()
            .answers(RFC_CHALLENGE)
    );
}

#[test]
fn a_challenge_must_be_a_base64url_digest() {
    assert!(SessionCodeChallenge::try_from(RFC_CHALLENGE.to_owned()).is_ok());
    for bad in [
        "",
        "short",
        // Padded, standard alphabet, one character too many.
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM=",
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM",
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cMA",
    ] {
        assert!(
            SessionCodeChallenge::try_from(bad.to_owned()).is_err(),
            "{bad:?} must be refused"
        );
    }
}

#[test]
fn a_verifier_must_be_43_to_128_unreserved_characters() {
    for good in [RFC_VERIFIER.to_owned(), "a".repeat(43), "~._-".repeat(32)] {
        assert!(
            SessionCodeVerifier::try_from(good.clone()).is_ok(),
            "{good}"
        );
    }
    for bad in [
        "a".repeat(42),
        "a".repeat(129),
        format!("{}=", "a".repeat(42)),
    ] {
        assert!(SessionCodeVerifier::try_from(bad.clone()).is_err(), "{bad}");
    }
}

#[test]
fn debug_never_prints_the_verifier() {
    assert!(!format!("{:?}", verifier(RFC_VERIFIER)).contains(RFC_VERIFIER));
}

#[test]
fn the_challenge_round_trips_through_json() {
    let challenge = SessionCodeChallenge::try_from(RFC_CHALLENGE.to_owned()).unwrap();
    let json = serde_json::to_string(&challenge).unwrap();
    assert_eq!(json, format!("\"{RFC_CHALLENGE}\""));
    assert_eq!(
        serde_json::from_str::<SessionCodeChallenge>(&json).unwrap(),
        challenge
    );
    assert!(serde_json::from_str::<SessionCodeChallenge>("\"nope\"").is_err());
}

#[test]
fn a_sent_verifier_is_read_from_its_header() {
    use axum::http::HeaderValue;
    assert!(matches!(
        SentVerifier::from_header(None),
        SentVerifier::Absent
    ));
    let valid = SentVerifier::from_header(Some(&HeaderValue::from_static(RFC_VERIFIER)));
    assert!(valid.answers(RFC_CHALLENGE));
    for malformed in [
        HeaderValue::from_static(""),
        HeaderValue::from_static("short"),
        HeaderValue::from_bytes(b"\xff".repeat(43).as_slice()).unwrap(),
    ] {
        let sent = SentVerifier::from_header(Some(&malformed));
        assert!(matches!(sent, SentVerifier::Malformed), "{malformed:?}");
        assert!(!sent.answers(RFC_CHALLENGE));
    }
    assert!(!format!("{valid:?}").contains(RFC_VERIFIER));
}
