use super::*;

#[test]
fn descriptor_uses_declared_source_cardinality() {
    let multi_select = ImportedPropertyDescriptor::of(&ImportedDocumentPropertyValue::Select {
        values: vec!["Planning".to_string()],
        multi: true,
    });
    assert_eq!(multi_select.stored_type, DataType::SelectString);
    assert!(multi_select.is_multi_select);
    assert_eq!(
        multi_select.definition_type,
        PropertyDataType::SelectString {
            options: Vec::new(),
            multi: true,
        }
    );

    let single_link = ImportedPropertyDescriptor::of(&ImportedDocumentPropertyValue::Link {
        urls: vec![
            "https://notion.so/roadmap".to_string(),
            "https://notion.so/spec".to_string(),
        ],
        multi: false,
    });
    assert_eq!(single_link.stored_type, DataType::Link);
    assert!(!single_link.is_multi_select);
    assert_eq!(
        single_link.definition_type,
        PropertyDataType::Link { multi: false }
    );
}
