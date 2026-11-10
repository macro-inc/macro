use super::database_index;

#[test]
fn group_slots_select_distinct_nonzero_databases() {
    let databases: Vec<_> = (0..8)
        .map(|slot| database_index(Some("email-parity"), Some(&slot.to_string())))
        .collect();
    assert_eq!(databases, vec![1, 2, 3, 4, 5, 6, 7, 8]);
}

#[test]
fn unsafe_or_missing_slot_assignments_fail() {
    for slot in [None, Some("none"), Some("-1"), Some("8"), Some("256")] {
        assert!(
            std::panic::catch_unwind(|| database_index(Some("email-parity"), slot)).is_err(),
            "unsafe slot {slot:?} must fail before connecting to Redis"
        );
    }
    for group in [None, Some("@global"), Some("another-group")] {
        assert!(
            std::panic::catch_unwind(|| database_index(group, Some("0"))).is_err(),
            "wrong group {group:?} must fail before connecting to Redis"
        );
    }
}
