use super::*;

#[test]
fn unfiltered_name_search_includes_crm_companies() {
    let search: NameSearch = serde_json::from_value(serde_json::json!({
        "name": "Atlas Labs",
    }))
    .unwrap();

    let request = search.unified_request(EntityFilters::default()).unwrap();

    assert!(request.include_crm);
    assert!(matches!(request.search_on, models_search::SearchOn::Name));
}

#[test]
fn type_filtered_name_search_excludes_crm_companies() {
    let search: NameSearch = serde_json::from_value(serde_json::json!({
        "name": "Atlas Labs",
        "entityTypes": ["documents", "channels"],
    }))
    .unwrap();

    let request = search.unified_request(EntityFilters::default()).unwrap();

    assert!(!request.include_crm);
}
