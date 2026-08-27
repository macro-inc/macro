use super::*;

#[test]
fn decimal_wire_format_is_canonical_and_bounded() {
    assert_eq!(CacheRevision::ZERO.to_string(), "0");
    assert_eq!(
        "18446744073709551615"
            .parse::<CacheRevision>()
            .unwrap()
            .to_string(),
        u64::MAX.to_string()
    );

    for invalid in ["", "-1", "+1", "01", " 1", "1.0", "18446744073709551616"] {
        assert!(
            invalid.parse::<CacheRevision>().is_err(),
            "accepted {invalid:?}"
        );
    }
}
