use super::*;
fn status(epoch: u32, next: u32, n: u32) -> FolderStatus {
    FolderStatus {
        uid_validity: Some(epoch),
        uid_next: Some(next),
        messages: n,
    }
}
#[test]
fn three_select_refusals_park_only_while_all_counters_match() {
    let before = status(8, 17, 16);
    let mut marker = PhantomFolder::failed(None, before, 0);
    assert!(!marker.skip(before, 1));
    marker = PhantomFolder::failed(Some(&marker), before, 1);
    assert!(!marker.skip(before, 2));
    marker = PhantomFolder::failed(Some(&marker), before, 2);
    assert!(marker.skip(before, 3));
    for changed in [status(9, 17, 16), status(8, 18, 16), status(8, 17, 15)] {
        assert!(!marker.skip(changed, 3));
    }
    assert!(!marker.skip(before, 2 + 6 * 3_600_000));
}
#[test]
fn quiet_primary_requires_two_independent_ahead_observations_in_the_same_epoch() {
    let mut stale = StaleView::default();
    let primary = status(8, 10, 1);
    let server = status(8, 12, 3);
    assert_eq!(known_uid_next(Some(10), Some(0)), Some(10));
    assert_eq!(known_uid_next(Some(10), Some(12)), Some(12));
    assert!(!stale.should_probe(Some(10), 0, 500));
    assert!(!stale.should_probe(Some(10), 499, 500));
    assert!(stale.should_probe(Some(10), 500, 500));
    assert!(!stale.stale_after_probe(primary, Some(server), 500));
    assert!(stale.should_probe(Some(10), 1000, 500));
    assert!(!stale.stale_after_probe(primary, Some(status(9, 12, 3)), 1000));
    assert!(stale.should_probe(Some(10), 1500, 500));
    assert!(!stale.stale_after_probe(primary, Some(server), 1500));
    assert!(stale.should_probe(Some(10), 2000, 500));
    assert!(stale.stale_after_probe(primary, Some(server), 2000));
    assert!(stale.should_probe(Some(10), 2500, 500));
    assert!(!stale.stale_after_probe(status(8, 11, 2), Some(server), 2500));
    assert!(!stale.should_probe(None, 3000, 500));
}
