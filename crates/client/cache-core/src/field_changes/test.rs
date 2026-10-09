use super::*;
use serde_json::json;

fn view(value: CacheValue) -> HashMap<EntityKey<'static>, Option<Record>> {
    HashMap::from([(
        EntityKey::entity("Thread", &["1"]),
        Some(Record {
            fields: BTreeMap::from([("isRead".into(), value)]),
        }),
    )])
}

#[test]
fn emits_only_changed_scalar_fields_and_rollback_values() {
    let base = view(CacheValue::Bool(false));
    let optimistic = view(CacheValue::Bool(true));
    let changes = between(&base, &optimistic);
    assert_eq!(
        serde_json::to_value(changes).unwrap(),
        json!([
            {"kind":"fields", "key":"Thread:1", "fields":{"isRead":true}}
        ])
    );
    assert_eq!(
        serde_json::to_value(between(&optimistic, &base)).unwrap(),
        json!([
            {"kind":"fields", "key":"Thread:1", "fields":{"isRead":false}}
        ])
    );
    assert!(between(&optimistic, &optimistic).is_empty());
}

#[test]
fn structural_changes_and_deletions_require_rereads() {
    let link = view(CacheValue::Ref(EntityKey::entity("Thread", &["2"])));
    let null = view(CacheValue::Null);
    let expected = json!([{"kind":"invalidate", "key":"Thread:1"}]);
    assert_eq!(
        serde_json::to_value(between(&link, &null)).unwrap(),
        expected
    );
    assert_eq!(
        serde_json::to_value(between(&null, &link)).unwrap(),
        expected
    );
    assert_eq!(
        serde_json::to_value(between(&null, &HashMap::new())).unwrap(),
        expected
    );
}
