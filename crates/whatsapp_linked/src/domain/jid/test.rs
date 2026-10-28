use super::*;

#[test]
fn every_kind_parses_with_one_limit() {
    for (text, kind) in [
        ("120363000000000001@g.us", Some(JidKind::Group)),
        ("15551234567-1600000000@g.us", Some(JidKind::Group)),
        ("15551234567@s.whatsapp.net", Some(JidKind::Phone)),
        ("987654321@lid", Some(JidKind::Lid)),
        ("@g.us", None),
        ("abc@g.us", None),
        ("1-@g.us", None),
        ("15551234567@s.whatsapp.net.evil", None),
        ("1555-1234567@s.whatsapp.net", None),
        ("15551234567:1@s.whatsapp.net", None),
        ("status@broadcast", None),
        ("", None),
    ] {
        assert_eq!(Jid::parse(text).map(|jid| jid.kind), kind, "{text}");
    }
    let longest = format!("{}@lid", "1".repeat(USER_LIMIT));
    assert!(is_person_jid(&longest));
    let too_long = format!("{}@lid", "1".repeat(USER_LIMIT + 1));
    assert!(!is_person_jid(&too_long));
    assert!(!is_group_jid(&format!(
        "{}@g.us",
        "1".repeat(USER_LIMIT + 1)
    )));
}

#[test]
fn only_phone_number_jids_have_a_number() {
    assert_eq!(
        phone_number("15551234567@s.whatsapp.net").as_deref(),
        Some("+15551234567")
    );
    assert_eq!(phone_number("987654321@lid"), None);
    assert_eq!(phone_number("120363000000000001@g.us"), None);
}
