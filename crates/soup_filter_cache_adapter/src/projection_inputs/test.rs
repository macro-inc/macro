use super::*;
use cache_core::meta::bundled_schema_ref;
use std::collections::BTreeSet;

#[test]
fn every_input_is_a_field_of_the_bundled_schema() {
    // A misspelt input would leave the documents it feeds complete after a
    // schema change removed their value.
    let schema = bundled_schema_ref();
    let inputs = projection_inputs();
    let unknown = inputs
        .fields()
        .filter(|(typename, field)| schema.field_meta(typename, field).is_none())
        .collect::<Vec<_>>();
    assert_eq!(unknown, Vec::<(&str, &str)>::new());
}

#[test]
fn every_indexed_type_names_its_inputs() {
    // A type that gains a projection without inputs would keep its documents
    // complete through any schema change.
    let inputs = projection_inputs();
    let named = inputs
        .fields()
        .map(|(typename, _)| typename)
        .collect::<BTreeSet<_>>();
    let unnamed = bundled_schema_ref()
        .artifact()
        .types
        .iter()
        .map(|meta| meta.name.as_str())
        .filter(|typename| {
            (crate::projection_partition(typename).is_some() || *typename == crate::mail::TYPE)
                && !named.contains(typename)
        })
        .collect::<Vec<_>>();
    assert_eq!(unnamed, Vec::<&str>::new());
    assert!(named.contains("GraphqlSoupEmailThread"));
    assert_eq!(named.len(), 8, "{named:?}");
}

/// Values a removed field may have held, of every JSON shape.
fn shapes() -> [serde_json::Value; 6] {
    [
        serde_json::Value::Null,
        serde_json::json!("2025-01-03T00:00:00Z"),
        serde_json::json!(1),
        serde_json::json!(true),
        serde_json::json!([]),
        serde_json::json!({"__typename": "GraphqlTaskSubType"}),
    ]
}

/// The fields of `typename` the bundled schema declares and `inputs` leaves
/// out.
fn unread(inputs: &ProjectionInputs, typename: &str) -> Vec<String> {
    let read = inputs
        .fields()
        .filter(|(owner, _)| *owner == typename)
        .map(|(_, field)| field)
        .collect::<BTreeSet<_>>();
    bundled_schema_ref()
        .type_meta(typename)
        .unwrap()
        .fields
        .iter()
        .map(|field| field.name.clone())
        .filter(|name| !read.contains(name.as_str()))
        .collect()
}

#[test]
fn a_field_no_input_names_never_changes_a_soup_document() {
    // What makes leaving a document complete sound: its facts are the same
    // whatever an unread field holds, or without it.
    let inputs = projection_inputs();
    let id = "00000000-0000-0000-0000-000000000001";
    let notification = serde_json::json!({
        "id": "00000000-0000-0000-0000-000000000002",
        "entityId": id,
        "state": "UNSEEN",
    });
    let direct = serde_json::json!({
        "id": id,
        "ownerId": "macro|owner@example.com",
        "createdAt": "2025-01-01T00:00:00Z",
        "updatedAt": "2025-01-02T00:00:00Z",
        "cacheProjection": null,
    });
    let with = |extra: serde_json::Value| {
        let mut object = direct.clone();
        object
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        object
    };
    let cases = [
        (
            "GraphqlSoupDocument",
            "DOCUMENT",
            with(serde_json::json!({"projectId": null, "fileType": "md", "subType": null})),
        ),
        (
            "GraphqlSoupProject",
            "PROJECT",
            with(serde_json::json!({"parentId": null})),
        ),
        (
            "GraphqlSoupChat",
            "CHAT",
            with(serde_json::json!({"projectId": null})),
        ),
        (
            "GraphqlSoupChannel",
            "CHANNEL",
            with(
                serde_json::json!({"channelType": "public", "teamId": null, "organizationId": null, "isParticipant": true}),
            ),
        ),
        (
            "GraphqlSoupDatabaseRow",
            "DATABASE_ROW",
            with(serde_json::json!({"tableId": "00000000-0000-0000-0000-000000000003"})),
        ),
    ];
    let mut checked = 0;
    for (typename, entity_type, mut object) in cases {
        let mut notification = notification.clone();
        notification["targetEntityType"] = serde_json::json!(entity_type);
        object["notifications"] = serde_json::json!([notification]);
        let key = predicate_index::RecordKey::new(format!("{typename}:{id}")).unwrap();
        let partition = crate::projection_partition(typename).unwrap();
        let supplement = (typename == "GraphqlSoupDocument").then(|| {
            soup_filter_projection::SoupCacheProjectionSupplement::document(
                key.clone(),
                false,
                true,
                Vec::new(),
            )
        });
        let project = |object: &serde_json::Value| {
            crate::complete_v4_projection_for_object(
                key.clone(),
                partition.clone(),
                object.as_object().unwrap(),
                supplement.as_ref(),
            )
        };
        let document = project(&object).unwrap_or_else(|()| panic!("{typename} projects"));
        assert!(
            document
                .exact_facts
                .iter()
                .any(|fact| fact.attribute.as_str().contains("notification")),
            "{typename} holds its notification: {document:?}"
        );
        for field in unread(&inputs, typename) {
            for value in shapes() {
                let mut changed = object.clone();
                changed[&field] = value.clone();
                assert_eq!(
                    project(&changed),
                    Ok(document.clone()),
                    "{typename}.{field} = {value}"
                );
                checked += 1;
            }
        }
        for field in unread(&inputs, "GraphqlNotification") {
            for value in shapes() {
                let mut changed = object.clone();
                changed["notifications"][0][&field] = value.clone();
                assert_eq!(
                    project(&changed),
                    Ok(document.clone()),
                    "GraphqlNotification.{field} = {value}"
                );
                checked += 1;
            }
        }
    }
    assert!(checked > 500, "{checked}");
}
