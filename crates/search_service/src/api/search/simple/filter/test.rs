use super::*;

#[test]
fn the_email_attachment_filter_reaches_the_document_search() {
    let filtered = || FilterDocumentResponse {
        document_ids: vec!["d1".to_string()],
        ids_only: false,
    };
    let filters = |is_email_attachment| item_filters::DocumentFilters {
        is_email_attachment,
        ..Default::default()
    };

    let excluded = document_search_args(&filters(Some(false)), filtered());
    let only = document_search_args(&filters(Some(true)), filtered());
    let either = document_search_args(&filters(None), filtered());

    assert_eq!(excluded.is_email_attachment, Some(false));
    assert_eq!(only.is_email_attachment, Some(true));
    assert_eq!(either.is_email_attachment, None);
}
