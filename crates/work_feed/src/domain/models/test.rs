use super::*;

#[test]
fn work_mode_alone_admits_own_work() {
    assert!(WorkFeedMode::Work.own_work());
    assert!(!WorkFeedMode::Attention.own_work());
}

#[test]
fn every_item_type_names_a_distinct_candidate_type() {
    let mut types: Vec<_> = WorkFeedItemType::ALL
        .iter()
        .map(|item_type| item_type.entity_type())
        .collect();
    types.dedup();
    assert_eq!(types.len(), WorkFeedItemType::ALL.len());
}
