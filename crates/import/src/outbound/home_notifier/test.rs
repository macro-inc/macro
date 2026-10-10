use super::*;

#[test]
fn notification_ids_are_stable_per_user_and_document() {
    let first = notification_id("macro|dana@example.com", "doc-1");
    assert_eq!(first, notification_id("macro|dana@example.com", "doc-1"));
    assert_ne!(first, notification_id("macro|dana@example.com", "doc-2"));
    assert_ne!(first, notification_id("macro|sam@example.com", "doc-1"));
}

#[test]
fn only_notion_and_linear_items_surface() {
    assert_eq!(
        imported_from(ImportSource::Notion),
        Some(ImportedFrom::Notion)
    );
    assert_eq!(
        imported_from(ImportSource::Linear),
        Some(ImportedFrom::Linear)
    );
    assert_eq!(imported_from(ImportSource::Slack), None);
    let user = macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|dana@example.com")
        .unwrap()
        .into_owned();
    let slack = ActiveImport {
        source: ImportSource::Slack,
        entity_id: "c1".into(),
        name: "general".into(),
    };
    assert!(request(&user, &slack).is_none());
    let notion = ActiveImport {
        source: ImportSource::Notion,
        ..slack
    };
    assert!(request(&user, &notion).is_some());
}
