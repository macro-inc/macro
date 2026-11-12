use super::*;

#[test]
fn cursor_rejects_nul_but_can_advance_past_a_malformed_legacy_id() {
    assert!(ContactCursor::from_position("bad\0cursor".into()).is_none());
    assert_eq!(
        ContactCursor::from_position("broken-id".into())
            .unwrap()
            .position(),
        "broken-id"
    );
}

#[test]
fn page_sizes_reject_unbounded_and_empty_reads() {
    assert!(ContactPageSize::new(0).is_none());
    assert!(ContactPageSize::new(501).is_none());
    assert!(ContactPageSize::new(u16::MAX).is_none());
    assert_eq!(ContactPageSize::new(1).unwrap().get(), 1);
    assert_eq!(ContactPageSize::new(500).unwrap().get(), 500);
    assert_eq!(ContactPageSize::DEFAULT.get(), 100);
}
