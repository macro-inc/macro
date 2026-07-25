use super::*;
use import::domain::ports::ImportedDocumentPropertyValue;

#[test]
fn imported_property_type_uses_source_cardinality() {
    let single_value_multi_select = ImportedDocumentPropertyValue::Select {
        values: vec!["Planning".to_string()],
        multi: true,
    };
    assert!(imported_property_type(&single_value_multi_select).2);

    let multiple_value_single_select = ImportedDocumentPropertyValue::Select {
        values: vec!["Planning".to_string(), "Roadmap".to_string()],
        multi: false,
    };
    assert!(!imported_property_type(&multiple_value_single_select).2);

    let single_value_multi_link = ImportedDocumentPropertyValue::Link {
        urls: vec!["https://notion.so/roadmap".to_string()],
        multi: true,
    };
    assert!(imported_property_type(&single_value_multi_link).2);

    let multiple_value_single_link = ImportedDocumentPropertyValue::Link {
        urls: vec![
            "https://notion.so/roadmap".to_string(),
            "https://notion.so/spec".to_string(),
        ],
        multi: false,
    };
    assert!(!imported_property_type(&multiple_value_single_link).2);
}
