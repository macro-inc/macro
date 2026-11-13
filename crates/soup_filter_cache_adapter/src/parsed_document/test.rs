use super::{RECENT_DOCUMENTS, parsed_document};
use std::sync::Arc;

#[test]
fn parses_a_document_text_once_and_shares_it() {
    let query = "query Shared { user { id } }";
    let first = parsed_document(query).unwrap();
    let second = parsed_document(query).unwrap();

    assert!(Arc::ptr_eq(&first, &second));
    assert_eq!(first.operations[0].name.as_deref(), Some("Shared"));
}

#[test]
fn keeps_only_recent_documents_and_never_an_invalid_one() {
    let oldest = "query Oldest { user { id } }";
    let before = parsed_document(oldest).unwrap();
    for index in 0..RECENT_DOCUMENTS {
        parsed_document(&format!("query Later{index} {{ user {{ id }} }}")).unwrap();
    }
    let after = parsed_document(oldest).unwrap();
    assert!(!Arc::ptr_eq(&before, &after));

    assert!(parsed_document("query Broken {").is_err());
    assert!(parsed_document("query Broken {").is_err());
}
