use super::*;

#[test]
fn duplicate_rows_in_a_table_without_a_primary_key_are_counted() {
    if !crate::parity::process_per_test() {
        return;
    }
    let row = json!({"value": "same"});
    let before = Snapshot {
        tables: BTreeMap::from([("table".into(), (vec![], vec![row.clone(), row.clone()]))]),
    };
    let after = Snapshot {
        tables: BTreeMap::from([("table".into(), (vec![], vec![row.clone()]))]),
    };
    assert_eq!(
        before.changes(after),
        json!({"table":{"removed":[row],"added":[],"changed":[]}})
    );
}

#[test]
fn a_table_created_during_the_step_is_not_missed() {
    if !crate::parity::process_per_test() {
        return;
    }
    let row = json!({"id": 1});
    let before = Snapshot {
        tables: BTreeMap::new(),
    };
    let after = Snapshot {
        tables: BTreeMap::from([("unexpected".into(), (vec!["id".into()], vec![row.clone()]))]),
    };
    assert_eq!(
        before.changes(after),
        json!({"unexpected":{"removed":[],"added":[row],"changed":[]}})
    );
}

#[test]
fn changed_rows_keep_keys_and_only_changed_columns() {
    if !crate::parity::process_per_test() {
        return;
    }
    let before_row = json!({"id":1,"name":"untouched","flag":false,
        "updated_at":"2026-01-01T00:00:00Z"});
    let after_row = json!({"id":1,"name":"untouched","flag":true,
        "updated_at":"2026-01-02T00:00:00Z"});
    let snapshot = |row| Snapshot {
        tables: BTreeMap::from([("table".into(), (vec!["id".into()], vec![row]))]),
    };
    let change = snapshot(before_row).changes(snapshot(after_row));
    let mut normalizer = crate::parity::normalize::Normalizer::default();
    assert_eq!(
        normalizer.value("db", change),
        json!({"table":{
        "removed":[],"added":[],"changed":[{"id":1,"flag":{"before":false,"after":true},
        "updated_at":{"before":"<ts>","after":"<ts:changed>"}}]}})
    );
}

#[test]
fn a_timestamp_only_write_is_visible() {
    if !crate::parity::process_per_test() {
        return;
    }
    let change = changed_row(
        &["id".into()],
        &json!({"id":2,"name":"same",
        "updated_at":"2026-01-01T00:00:00Z"}),
        &json!({"id":2,"name":"same",
        "updated_at":"2026-01-01T00:00:01Z"}),
    );
    let mut normalizer = crate::parity::normalize::Normalizer::default();
    assert_eq!(
        normalizer.value("db", change),
        json!({"id":2,
        "updated_at":{"before":"<ts>","after":"<ts:changed>"}})
    );
}
