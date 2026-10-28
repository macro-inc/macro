use super::*;
use serde_json::json;
use std::collections::BTreeMap;

fn property(definition: &str) -> Record {
    Record {
        fields: BTreeMap::from([(
            "propertyDefinitionId".into(),
            CacheValue::String(definition.into()),
        )]),
    }
}

#[test]
fn upsert_preserves_other_types_without_resolving_their_records() {
    let inserted = EntityKey("GraphqlProperty:server-1".into());
    let replaced = EntityKey("GraphqlProperty:temporary-1".into());
    let retained = EntityKey("GraphqlProperty:status-1".into());
    let missing_other_type = EntityKey("GraphqlSoupDocument:missing".into());
    let present_other_type = EntityKey("GraphqlSoupDocument:present".into());
    let effective = HashMap::from([
        (inserted.clone(), property("priority")),
        (replaced.clone(), property("priority")),
        (retained.clone(), property("status")),
        (present_other_type.clone(), Record::default()),
    ]);
    let mut links = vec![
        CacheValue::Ref(replaced.clone()),
        CacheValue::Ref(missing_other_type.clone()),
        CacheValue::Null,
        CacheValue::Ref(present_other_type.clone()),
        CacheValue::Ref(retained.clone()),
        CacheValue::Ref(replaced),
    ];
    let expected = vec![
        CacheValue::Ref(inserted.clone()),
        CacheValue::Ref(missing_other_type),
        CacheValue::Null,
        CacheValue::Ref(present_other_type),
        CacheValue::Ref(retained),
    ];

    // Replay remains idempotent, including when unrelated records are absent.
    for _ in 0..2 {
        apply(
            &mut links,
            &effective,
            "propertyDefinitionId",
            &json!("priority"),
            &inserted,
        )
        .unwrap();
        assert_eq!(links, expected);
    }
}

#[test]
fn upsert_rejects_missing_target_type_records_without_changing_links() {
    let inserted = EntityKey("GraphqlProperty:server-1".into());
    let replaced = EntityKey("GraphqlProperty:temporary-1".into());
    let missing = EntityKey("GraphqlProperty:missing".into());
    let effective = HashMap::from([
        (inserted.clone(), property("priority")),
        (replaced.clone(), property("priority")),
    ]);
    let mut links = vec![CacheValue::Ref(replaced), CacheValue::Ref(missing.clone())];
    let original = links.clone();

    assert_eq!(
        apply(
            &mut links,
            &effective,
            "propertyDefinitionId",
            &json!("priority"),
            &inserted,
        ),
        Err(LinkPatchError::MissingParent(missing))
    );
    assert_eq!(links, original);
}

#[test]
fn upsert_preserves_member_position_for_existing_and_recreated_assignments() {
    let before = EntityKey("GraphqlProperty:status".into());
    let previous = EntityKey("GraphqlProperty:old-tags".into());
    let canonical = EntityKey("GraphqlProperty:new-tags".into());
    let after = EntityKey("GraphqlProperty:priority".into());
    let effective = HashMap::from([
        (before.clone(), property("status")),
        (previous.clone(), property("tags")),
        (canonical.clone(), property("tags")),
        (after.clone(), property("priority")),
    ]);

    for inserted in [&previous, &canonical] {
        let mut links = vec![
            CacheValue::Ref(before.clone()),
            CacheValue::Ref(previous.clone()),
            CacheValue::Ref(after.clone()),
        ];
        // Both ordinary edits and response-derived ID replacements are stable
        // across optimistic installation, settlement, and replay.
        for _ in 0..2 {
            apply(
                &mut links,
                &effective,
                "propertyDefinitionId",
                &json!("tags"),
                inserted,
            )
            .unwrap();
            assert_eq!(
                links,
                vec![
                    CacheValue::Ref(before.clone()),
                    CacheValue::Ref(inserted.clone()),
                    CacheValue::Ref(after.clone()),
                ]
            );
        }
    }
}
