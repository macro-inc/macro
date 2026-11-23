use super::*;
use opensearch_query_builder::ToOpenSearchJson;
use serde_json::json;

#[test]
fn document_and_property_alternatives_remain_required_filters() {
    let documents: Expr<DocumentLiteral> = serde_json::from_value(json!({"&": [
        {"l": {"dst": "task"}},
        {"|": [
            {"l": {"o": "macro|viewer@example.com"}},
            {"l": {"prop": {"pd": "00000001-0000-0000-0000-000000000001", "v": {"er": "macro|viewer@example.com"}}}}
        ]}
    ]})).unwrap();
    let properties: Expr<PropertiesLiteral> = serde_json::from_value(json!({"l": {
        "pd": "00000001-0000-0000-0000-000000000002",
        "v": {"so": "00000000-0000-0000-0002-000000000001"}
    }}))
    .unwrap();
    let query = compile_filter_expression(Some(&documents), Some(&properties))
        .unwrap()
        .to_query()
        .unwrap()
        .to_json();
    let required = query["bool"]["filter"].as_array().unwrap();
    assert_eq!(required.len(), 2);
    let membership = &required[0]["bool"]["filter"][1]["bool"];
    assert_eq!(membership["minimum_should_match"], 1);
    assert_eq!(
        membership["should"][0],
        json!({"term": {"owner_id": "macro|viewer@example.com"}})
    );
    assert_eq!(
        membership["should"][1]["nested"]["query"]["bool"]["filter"][1],
        json!({"terms": {"properties.values": ["macro|viewer@example.com"]}})
    );
    assert!(required[1].get("nested").is_some());
}

#[test]
fn ordinary_documents_can_use_or_and_not_without_task_membership() {
    let documents: Expr<DocumentLiteral> = serde_json::from_value(json!({"|": [
        {"l": {"ft": "pdf"}},
        {"!": {"l": {"o": "macro|excluded@example.com"}}}
    ]}))
    .unwrap();
    let query = compile_filter_expression(Some(&documents), None)
        .unwrap()
        .to_query()
        .unwrap()
        .to_json();
    let alternatives = &query["bool"]["filter"][0]["bool"];
    assert_eq!(alternatives["minimum_should_match"], 1);
    assert_eq!(
        alternatives["should"][0],
        json!({"term": {"file_type": "pdf"}})
    );
    assert_eq!(
        alternatives["should"][1]["bool"]["must_not"][0],
        json!({"term": {"owner_id": "macro|excluded@example.com"}})
    );
    assert!(!query.to_string().contains("sub_type"));
}

#[test]
fn missing_dates_negate_the_whole_nested_date_predicate() {
    let properties: Expr<PropertiesLiteral> = serde_json::from_value(json!({"!": {"l": {
        "pd": "00000001-0000-0000-0000-000000000005", "et": "TASK", "v": {"dr": {}}
    }}}))
    .unwrap();
    let query = compile_filter_expression(None, Some(&properties))
        .unwrap()
        .to_query()
        .unwrap()
        .to_json();
    let missing = &query["bool"]["filter"][0]["bool"]["must_not"][0]["bool"];
    assert_eq!(missing["minimum_should_match"], 1);
    let exact = &missing["should"][0]["bool"]["filter"][0]["nested"]["query"]["bool"]["filter"];
    assert_eq!(
        exact[1],
        json!({"exists": {"field": "properties.date_value"}})
    );
    assert_eq!(
        exact[2],
        json!({"term": {"properties.entity_type": "TASK"}})
    );
    let legacy = &missing["should"][1]["bool"]["filter"];
    assert_eq!(legacy[0], json!({"term": {"sub_type": "task"}}));
    assert_eq!(
        legacy[1]["bool"]["filter"][0]["nested"]["query"]["bool"]["filter"][2]["bool"]["must_not"]
            [0],
        json!({"exists": {"field": "properties.entity_type"}})
    );
}

#[test]
fn every_branch_rejects_unindexed_document_predicates() {
    let documents: Expr<DocumentLiteral> = serde_json::from_value(json!({"|": [
        {"l": {"id": "00000000-0000-0000-0000-000000000001"}},
        {"!": {"l": {"ca": {"gte": "2026-01-01T00:00:00Z"}}}}
    ]}))
    .unwrap();
    assert_eq!(
        compile_filter_expression(Some(&documents), None).unwrap_err(),
        FilterExpressionError::DocumentPredicate
    );
}

#[test]
fn explicit_unindexed_property_namespaces_are_rejected() {
    let properties: Expr<PropertiesLiteral> = serde_json::from_value(json!({"l": {
        "pd": "00000001-0000-0000-0000-000000000001", "et": "INITIATIVE", "v": {"er": "macro|viewer@example.com"}
    }})).unwrap();
    assert_eq!(
        compile_filter_expression(None, Some(&properties)).unwrap_err(),
        FilterExpressionError::PropertyNamespace
    );
}

#[test]
fn explicit_document_and_task_namespaces_stay_distinct_with_legacy_fallback() {
    for namespace in ["DOCUMENT", "TASK"] {
        let properties: Expr<PropertiesLiteral> = serde_json::from_value(json!({"l": {
            "pd": "00000001-0000-0000-0000-000000000001", "et": namespace,
            "v": {"er": "macro|viewer@example.com"}
        }}))
        .unwrap();
        let query = compile_filter_expression(None, Some(&properties))
            .unwrap()
            .to_query()
            .unwrap()
            .to_json();
        let alternatives = &query["bool"]["filter"][0]["bool"];
        assert_eq!(alternatives["minimum_should_match"], 1);
        let predicates = &alternatives["should"][0]["nested"]["query"]["bool"]["filter"];
        assert_eq!(
            predicates[2],
            json!({"term": {"properties.entity_type": namespace}})
        );
        let legacy = &alternatives["should"][1]["bool"];
        if namespace == "TASK" {
            assert_eq!(legacy["filter"][0], json!({"term": {"sub_type": "task"}}));
        } else {
            assert_eq!(legacy["must_not"][0], json!({"term": {"sub_type": "task"}}));
        }
    }
}

#[test]
fn excluding_email_attachments_includes_legacy_missing_flags() {
    let documents = Expr::val(DocumentLiteral::IsEmailAttachment(false));
    let query = compile_filter_expression(Some(&documents), None)
        .unwrap()
        .to_query()
        .unwrap()
        .to_json();
    assert_eq!(
        query["bool"]["filter"][0],
        json!({"bool": {"must_not": [{"term": {"is_email_attachment": true}}]}})
    );
}
