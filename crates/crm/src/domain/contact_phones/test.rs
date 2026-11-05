use super::*;

#[test]
fn typed_numbers_are_normalized_deduplicated_and_validated() {
    let phones = parse_contact_phones(&[
        "+1 (555) 010".to_owned(),
        "+1555010".to_owned(),
        "+44 20 123".to_owned(),
    ])
    .unwrap();
    let phones: Vec<&str> = phones.iter().map(PhoneNumber::as_str).collect();
    assert_eq!(phones, ["+1555010", "+4420123"]);

    let error = parse_contact_phones(&["+1555010".to_owned(), "020 123".to_owned()]).unwrap_err();
    assert!(
        matches!(&error, CrmError::InvalidRequest(message)
            if message.starts_with("Phone number 2 ") && !message.contains("020")),
        "{error}"
    );

    let too_many: Vec<String> = (0..=MAX_CONTACT_PHONES)
        .map(|n| format!("+155501{n:02}"))
        .collect();
    assert!(parse_contact_phones(&too_many).is_err());
}
