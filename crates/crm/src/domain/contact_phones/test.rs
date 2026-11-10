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

    let mut too_many: Vec<String> = (0..=MAX_CONTACT_PHONES)
        .map(|n| format!("+155501{n:02}"))
        .collect();
    // The cap stops reading at the first number past it, so a huge request
    // costs no more than a full one.
    too_many.push("not a number".to_owned());
    assert!(
        matches!(&parse_contact_phones(&too_many),
            Err(CrmError::InvalidRequest(message)) if message.contains("at most")),
        "{:?}",
        parse_contact_phones(&too_many)
    );
}
