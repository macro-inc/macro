use super::*;
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;

fn document(file_type: &str) -> DocumentBasic {
    DocumentBasic {
        document_id: "native-document".into(),
        document_name: "Notes".into(),
        owner: Owner::from_principal_str("macro|reader@macro.local").unwrap(),
        file_type: Some(file_type.into()),
        sub_type: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        project_id: None,
        deleted_at: None,
    }
}
fn access(id: &str, kind: EntityType) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::parse_from_str("macro|reader@macro.local").unwrap(),
        id,
        kind,
    )
}
#[test]
fn live_markdown_does_not_use_legacy_object_storage() {
    let receipt = access("native-document", EntityType::Document);
    assert_eq!(
        source(&receipt, &document("md")).unwrap(),
        TextSource::Markdown
    );
    for kind in ["pdf", "docx"] {
        assert_eq!(
            source(&receipt, &document(kind)).unwrap(),
            TextSource::Extracted
        );
    }
    for kind in ["txt", "png", "spreadsheet", "fig"] {
        assert_eq!(
            source(&receipt, &document(kind)).unwrap(),
            TextSource::Export
        );
    }
}
#[test]
fn wrong_document_or_wrong_entity_capability_is_rejected() {
    assert!(matches!(
        source(&access("other", EntityType::Document), &document("md")),
        Err(DocumentError::Unauthorized)
    ));
    assert!(matches!(
        source(
            &access("native-document", EntityType::AgentSession),
            &document("md")
        ),
        Err(DocumentError::Unauthorized)
    ));
}
