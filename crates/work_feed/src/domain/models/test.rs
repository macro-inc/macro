use super::*;

#[test]
fn work_mode_alone_admits_own_work() {
    assert!(WorkFeedMode::Work.own_work());
    assert!(!WorkFeedMode::Attention.own_work());
}
