use super::*;
#[test]
fn fingerprint_hydration_normalizes_input_with_the_btree_map() {
    let rows = ["中", "a:b", "é", "Z", "a", "A"]
        .into_iter()
        .map(|key| {
            Entry::new(StateEntryKind::Location, key.into(), &serde_json::json!({})).unwrap()
        })
        .collect::<Vec<_>>();
    let mut reversed = rows.clone();
    reversed.reverse();
    let keys = |rows| {
        normalize_entries(rows)
            .into_iter()
            .map(|row| row.key)
            .collect::<Vec<_>>()
    };
    assert_eq!(keys(rows), keys(reversed));
    assert_eq!(
        keys(
            ["A", "Z", "a", "a:b", "é", "中"]
                .into_iter()
                .map(
                    |key| Entry::new(StateEntryKind::Location, key.into(), &serde_json::json!({}))
                        .unwrap()
                )
                .collect()
        ),
        vec!["A", "Z", "a", "a:b", "é", "中"]
    );
}
