use super::PhoneNumber;

// Seven-digit numbers: still E.164, and none reads as anyone's real number.

#[test]
fn formatted_numbers_normalize_to_one_form() {
    for text in ["+1 (555) 010", "+1.555.010", "001 555 010", " +1555010 "] {
        assert_eq!(
            PhoneNumber::parse(text).map(|n| n.as_str().to_owned()),
            Some("+1555010".to_owned()),
            "{text}"
        );
    }
}

#[test]
fn numbers_without_a_country_code_are_rejected() {
    for text in [
        "(555) 010",
        "020 1234",
        "+0 20 1234",
        "+44 20 123 ext 12",
        "+12345",
        "+1234567890123456",
        "",
    ] {
        assert_eq!(PhoneNumber::parse(text), None, "{text}");
    }
}

#[test]
fn numbers_without_a_known_grouping_read_as_stored() {
    let readable = |text: &str| PhoneNumber::parse(text).unwrap().readable();
    assert_eq!(readable("+1555010"), "+1555010");
    assert_eq!(readable("+4420555"), "+4420555");
}
