use super::*;
use crate::document::Document;
use crate::entity_resolver::EntityResolver;
use crate::identity::{DELETED_FIELD, alias_record};
use crate::normalize::normalize;
use serde_json::json;

const QUERY: &str = r#"query {
    user {
        id
        emailThread(input: {threadId: "deleted"}) { id }
        soup(input: {limit: 10}) { items { __typename id } }
    }
}"#;

fn fixture() -> (
    Document,
    std::collections::BTreeMap<EntityKey<'static>, Record>,
) {
    let doc = Document::parse(QUERY).unwrap();
    let records = normalize(
        doc.operation(None).unwrap(),
        &Default::default(),
        &json!({"user": {
            "id": "user",
            "emailThread": {"id": "deleted"},
            "soup": {"items": [
                {"__typename": "GraphqlSoupEmailThread", "id": "deleted"},
                {"__typename": "GraphqlSoupEmailThread", "id": "kept"}
            ]}
        }}),
    )
    .unwrap();
    (doc, records)
}

#[test]
fn deleted_links_are_absent_without_hiding_the_page_including_through_aliases() {
    for aliased in [false, true] {
        let (doc, mut records) = fixture();
        let local = EntityKey::entity("GraphqlSoupEmailThread", &["deleted"]);
        let target = if aliased {
            let target = EntityKey::entity("GraphqlSoupEmailThread", &["server"]);
            records.insert(local.clone(), alias_record(&target));
            target
        } else {
            local.clone()
        };
        records
            .entry(target.clone())
            .or_default()
            .fields
            .insert(DELETED_FIELD.into(), CacheValue::Bool(true));
        let mut deps = BTreeSet::new();
        let outcome = denormalize(
            doc.operation(None).unwrap(),
            &Default::default(),
            &records,
            &mut deps,
        )
        .unwrap();
        let ReadOutcome::Complete(data) = outcome else {
            panic!("expected complete read: {outcome:?}")
        };
        assert_eq!(data["user"]["emailThread"], Json::Null);
        assert_eq!(
            data["user"]["soup"]["items"],
            json!([
                {"__typename": "GraphqlSoupEmailThread", "id": "kept"}
            ])
        );
        assert!(deps.contains(&local));
        assert!(deps.contains(&target));

        let resolvers = EntityResolverLookup::compile(&[EntityResolver {
            parent_type: "GraphqlUser".into(),
            field_name: "emailThread".into(),
            target_type: "GraphqlSoupEmailThread".into(),
            argument_path: vec!["input".into(), "threadId".into()],
        }])
        .unwrap();
        let resolved = denormalize_with_entity_resolvers(
            doc.operation(None).unwrap(),
            &Default::default(),
            &records,
            &mut BTreeSet::new(),
            &resolvers,
        )
        .unwrap();
        assert!(matches!(resolved, ReadOutcome::Complete(resolved) if resolved == data));

        // Explicit record reads still report the deleted entity as unavailable.
        let fragment = Document::parse("query { id }").unwrap();
        assert!(matches!(denormalize_record(
            &local, "GraphqlSoupEmailThread", &fragment.operation(None).unwrap().selection_set,
            &Default::default(), &records, &mut BTreeSet::new(),
        ).unwrap(), ReadOutcome::Miss { field, .. } if field == "deleted cache identity"));
    }
}

#[test]
fn unknown_records_and_alias_cycles_still_make_the_read_incomplete() {
    let (doc, mut records) = fixture();
    let local = EntityKey::entity("GraphqlSoupEmailThread", &["deleted"]);
    let target = EntityKey::entity("GraphqlSoupEmailThread", &["server"]);
    records.insert(local.clone(), alias_record(&target));
    let outcome = denormalize(
        doc.operation(None).unwrap(),
        &Default::default(),
        &records,
        &mut BTreeSet::new(),
    )
    .unwrap();
    assert!(matches!(outcome, ReadOutcome::NeedRecords(keys) if keys.contains(&target)));
    records.insert(target, alias_record(&local));
    let outcome = denormalize(
        doc.operation(None).unwrap(),
        &Default::default(),
        &records,
        &mut BTreeSet::new(),
    )
    .unwrap();
    assert!(matches!(outcome, ReadOutcome::Miss { field, .. } if field == "cyclic cache identity"));
}

#[test]
fn required_singular_links_cannot_return_null_for_a_deleted_record() {
    let (doc, mut records) = fixture();
    records
        .get_mut(&EntityKey::entity("GraphqlUser", &["user"]))
        .unwrap()
        .fields
        .insert(DELETED_FIELD.into(), CacheValue::Bool(true));
    let outcome = denormalize(
        doc.operation(None).unwrap(),
        &Default::default(),
        &records,
        &mut BTreeSet::new(),
    )
    .unwrap();
    assert!(
        matches!(outcome, ReadOutcome::Miss { field, .. } if field == "deleted cache identity")
    );
}
