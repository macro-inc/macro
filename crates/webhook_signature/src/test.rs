use super::*;

#[test]
fn sign_and_verify_round_trip() {
    let signature = sign("secret", "1755188000", b"{\"a\":1}").unwrap();
    assert!(signature.starts_with("v1="));
    assert!(verify("secret", "1755188000", b"{\"a\":1}", &signature));
}

#[test]
fn tampering_fails_verification() {
    let signature = sign("secret", "1755188000", b"{\"a\":1}").unwrap();
    assert!(!verify("secret", "1755188000", b"{\"a\":2}", &signature));
    assert!(!verify("secret", "1755188001", b"{\"a\":1}", &signature));
    assert!(!verify("other", "1755188000", b"{\"a\":1}", &signature));
    assert!(!verify("secret", "1755188000", b"{\"a\":1}", "v1=zz"));
    assert!(!verify("secret", "1755188000", b"{\"a\":1}", "nope"));
}

/// Pin the digest so the scheme can never drift from the TS verifier
/// (`packages/sdk/src/events/verify.ts`) without a test moving.
#[test]
fn the_wire_format_is_pinned() {
    assert_eq!(
        sign("secret", "1700000000", b"body").unwrap(),
        format!("v1={}", {
            let mut mac = HmacSha256::new_from_slice(b"secret").unwrap();
            mac.update(b"1700000000.body");
            hex::encode(mac.finalize().into_bytes())
        })
    );
}
