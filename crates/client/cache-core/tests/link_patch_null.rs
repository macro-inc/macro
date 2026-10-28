//! Optional null parents do not invalidate mutations; malformed shapes still do.

use cache_core::link_patch::{
    LinkOperation, LinkPatchError, LinkPathSegment, OptimisticLinkPatch, apply_link_patches,
};
use cache_core::value::{CacheValue, EntityKey, Record};
use std::collections::{BTreeMap, HashMap};

fn patch() -> OptimisticLinkPatch {
    OptimisticLinkPatch {
        query: "query { user { emailThread { messages { id } } } }".into(),
        record_root: None,
        operation_name: None,
        variables_json: "{}".into(),
        path: ["user", "emailThread", "messages"]
            .into_iter()
            .map(|field| LinkPathSegment::Field {
                field: field.into(),
            })
            .collect(),
        operation: LinkOperation::Remove {
            entity_key: EntityKey("GraphqlSoupEmailMessage:draft".into()),
        },
    }
}

fn records(thread: CacheValue) -> HashMap<EntityKey<'static>, Record> {
    HashMap::from([(
        EntityKey::root(),
        Record {
            fields: BTreeMap::from([(
                "user".into(),
                CacheValue::Object(BTreeMap::from([("emailThread".into(), thread)])),
            )]),
        },
    )])
}

#[test]
fn strict_patch_skips_a_null_parent_without_inventing_a_thread() {
    let mut effective = records(CacheValue::Null);
    let before = effective.clone();
    let mut updates = BTreeMap::new();
    let applied = apply_link_patches(
        cache_core::meta::bundled_schema_ref(),
        &mut effective,
        &mut updates,
        &[patch()],
        false,
    )
    .unwrap();
    assert!(!applied);
    assert_eq!(effective, before);
    assert!(updates.is_empty());
}

#[test]
fn strict_query_patch_skips_an_uncached_normalized_relation() {
    let user = EntityKey("GraphqlUser:user".into());
    for user_record in [None, Some(Record::default())] {
        let mut effective = HashMap::from([(
            EntityKey::root(),
            Record {
                fields: BTreeMap::from([("user".into(), CacheValue::Ref(user.clone()))]),
            },
        )]);
        if let Some(record) = user_record {
            effective.insert(user.clone(), record);
        }
        let before = effective.clone();
        let mut updates = BTreeMap::new();
        let applied = apply_link_patches(
            cache_core::meta::bundled_schema_ref(),
            &mut effective,
            &mut updates,
            &[patch()],
            false,
        )
        .unwrap();
        assert!(!applied);
        assert_eq!(effective, before);
        assert!(updates.is_empty());
    }
}

#[test]
fn strict_patch_still_rejects_scalar_parents_and_null_target_lists() {
    for thread in [
        CacheValue::String("malformed thread".into()),
        CacheValue::Object(BTreeMap::from([("messages".into(), CacheValue::Null)])),
    ] {
        let mut effective = records(thread);
        let before = effective.clone();
        let mut updates = BTreeMap::new();
        assert_eq!(
            apply_link_patches(
                cache_core::meta::bundled_schema_ref(),
                &mut effective,
                &mut updates,
                &[patch()],
                false
            ),
            Err(LinkPatchError::WrongShape)
        );
        assert_eq!(effective, before);
        assert!(updates.is_empty());
    }
}
