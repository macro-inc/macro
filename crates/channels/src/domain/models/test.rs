use super::ReferencedShareItemType;

#[test]
fn from_raw_accepts_email_aliases_as_thread() {
    assert_eq!(
        ReferencedShareItemType::from_raw("thread"),
        Some(ReferencedShareItemType::EmailThread)
    );
    assert_eq!(
        ReferencedShareItemType::from_raw("email"),
        Some(ReferencedShareItemType::EmailThread)
    );
    assert_eq!(
        ReferencedShareItemType::from_raw("email_thread"),
        Some(ReferencedShareItemType::EmailThread)
    );
    assert_eq!(ReferencedShareItemType::EmailThread.as_str(), "thread");
}

#[test]
fn from_raw_rejects_unknown_types() {
    assert_eq!(ReferencedShareItemType::from_raw("unknown"), None);
    assert_eq!(ReferencedShareItemType::from_raw(""), None);
}

#[test]
fn reference_lookup_types_include_email_aliases_for_threads() {
    for requested in ["thread", "email", "email_thread"] {
        let types = ReferencedShareItemType::reference_lookup_types(requested);
        assert!(types.contains(&"thread".to_string()), "{requested}");
        assert!(types.contains(&"email".to_string()), "{requested}");
        assert!(types.contains(&"email_thread".to_string()), "{requested}");
    }

    assert_eq!(
        ReferencedShareItemType::reference_lookup_types("document"),
        vec!["document".to_string()]
    );
}
