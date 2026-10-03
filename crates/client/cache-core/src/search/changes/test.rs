use super::*;
use crate::value::CacheValue;

fn record(typename: &str) -> Record {
    Record {
        fields: [
            ("__typename".into(), CacheValue::String(typename.into())),
            ("name".into(), CacheValue::String("Example".into())),
        ]
        .into(),
    }
}

fn changes(typename: &str, before: Option<&Record>, after: Option<&Record>) -> BTreeSet<String> {
    let mut buckets = BTreeSet::new();
    collect_search_changes(
        &EntityKey::entity(typename, &["one"]),
        before,
        after,
        &mut buckets,
    );
    buckets
}

#[test]
fn new_rows_and_deletions_report_only_their_projection_bucket() {
    for (typename, bucket) in [
        ("GraphqlSoupDocument", "document"),
        ("GraphqlSoupEmailThread", "email"),
        ("GraphqlSoupChannel", "channel"),
        ("GraphqlSoupChat", "chat"),
        ("GraphqlSoupProject", "project"),
        ("GraphqlSoupCrmCompany", "crm_company"),
    ] {
        let value = record(typename);
        let expected = BTreeSet::from([bucket.to_owned()]);
        assert_eq!(changes(typename, None, Some(&value)), expected);
        assert_eq!(changes(typename, Some(&value), None), expected);
        assert!(changes(typename, Some(&value), Some(&value)).is_empty());
    }
}

#[test]
fn unrelated_fields_do_not_refresh_search_and_are_not_snapshotted() {
    let typename = "GraphqlSoupDocument";
    let before = record(typename);
    let mut after = before.clone();
    for field in ["properties", "notifications", "content", "comments"] {
        after
            .fields
            .insert(field.into(), CacheValue::String("unrelated".into()));
    }
    assert!(changes(typename, Some(&before), Some(&after)).is_empty());
    let snapshot = snapshot_search_fields(&EntityKey::entity(typename, &["one"]), &after).unwrap();
    assert_eq!(snapshot, before);
    assert!(changes("GraphqlProperty", None, Some(&record("GraphqlProperty"))).is_empty());
}

#[test]
fn materialized_fields_and_newly_available_fields_trigger_refreshes() {
    for typename in [
        "GraphqlSoupDocument",
        "GraphqlSoupChannel",
        "GraphqlSoupCrmCompany",
    ] {
        let before = record(typename);
        for field in [
            "name",
            "ownerId",
            "createdAt",
            "updatedAt",
            "viewedAt",
            "participants",
            "teamId",
        ] {
            let mut after = before.clone();
            after
                .fields
                .insert(field.into(), CacheValue::String("changed".into()));
            assert!(
                !changes(typename, Some(&before), Some(&after)).is_empty(),
                "{typename}.{field}"
            );
        }
    }
}

#[test]
fn bucket_moves_and_hidden_rows_invalidate_the_old_bucket_too() {
    let typename = "GraphqlSoupDocument";
    let before = record(typename);
    let mut after = before.clone();
    after
        .fields
        .insert("fileType".into(), CacheValue::String("md".into()));
    assert_eq!(
        changes(typename, Some(&before), Some(&after)),
        BTreeSet::from(["document".into(), "note".into()])
    );
    let visible = after.clone();
    after.fields.insert("hidden".into(), CacheValue::Bool(true));
    assert_eq!(
        changes(typename, Some(&visible), Some(&after)),
        BTreeSet::from(["note".into()])
    );
    after.fields.remove("hidden");
    after
        .fields
        .insert("deletedAt".into(), CacheValue::String("2026-09-29".into()));
    assert_eq!(
        changes(typename, Some(&visible), Some(&after)),
        BTreeSet::from(["note".into()])
    );
}
