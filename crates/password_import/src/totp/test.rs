use super::*;

#[test]
fn bare_base32_is_normalized() {
    assert_eq!(default_seed("jbsw y3dp ehpk 3pxp").as_ref().map(TotpSeed::expose_secret), Some("JBSWY3DPEHPK3PXP"));
    assert_eq!(default_seed("JBSWY3DPEHPK3PXP====").as_ref().map(TotpSeed::expose_secret), Some("JBSWY3DPEHPK3PXP"));
}

#[test]
fn default_otpauth_uri_becomes_a_seed() {
    assert_eq!(
        default_seed("otpauth://totp/Example:alice?secret=jbswy3dpehpk3pxp&issuer=Example").as_ref().map(TotpSeed::expose_secret),
        Some("JBSWY3DPEHPK3PXP")
    );
    assert_eq!(
        default_seed("OTPAUTH://TOTP/x?secret=JBSWY3DPEHPK3PXP&algorithm=sha1&digits=6&period=30").as_ref().map(TotpSeed::expose_secret),
        Some("JBSWY3DPEHPK3PXP")
    );
}

#[test]
fn non_default_parameters_are_refused() {
    assert_eq!(default_seed("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256").as_ref().map(TotpSeed::expose_secret), None);
    assert_eq!(default_seed("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=8").as_ref().map(TotpSeed::expose_secret), None);
    assert_eq!(default_seed("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=60").as_ref().map(TotpSeed::expose_secret), None);
    assert_eq!(default_seed("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1").as_ref().map(TotpSeed::expose_secret), None);
    assert_eq!(default_seed("otpauth://totp/x?secret=A&secret=B").as_ref().map(TotpSeed::expose_secret), None);
    assert_eq!(default_seed("otpauth://totp/x?issuer=Example").as_ref().map(TotpSeed::expose_secret), None);
    assert_eq!(default_seed("steam://JBSWY3DPEHPK3PXP").as_ref().map(TotpSeed::expose_secret), None);
}

#[test]
fn invalid_base32_is_refused() {
    assert_eq!(default_seed("").as_ref().map(TotpSeed::expose_secret), None);
    assert_eq!(default_seed("====").as_ref().map(TotpSeed::expose_secret), None);
    assert_eq!(default_seed("JBSWY3DP1").as_ref().map(TotpSeed::expose_secret), None);
    assert_eq!(default_seed(&"A".repeat(1025)).as_ref().map(TotpSeed::expose_secret), None);
    assert_eq!(default_seed(&"A".repeat(1024)).as_ref().map(TotpSeed::expose_secret), Some("A".repeat(1024).as_str()));
}
