use super::*;

#[test]
fn plan_is_deterministic_and_never_future_dated() {
    let now = Utc::now();
    let a = generate_plan("bigbox-10k@macro-test.com", 500, 42);
    let b = generate_plan("bigbox-10k@macro-test.com", 500, 42);
    assert_eq!(a.len(), 500);
    for (x, y) in a.iter().zip(&b) {
        assert_eq!(
            x.message_id, y.message_id,
            "same seed must give the same plan"
        );
        assert_eq!(x.subject, y.subject);
    }
    assert!(
        a.iter()
            .all(|m| m.date <= now + chrono::Duration::seconds(5)),
        "no message may be dated in the future"
    );
    let sent = a.iter().filter(|m| m.labels.contains(&"SENT")).count();
    assert!(sent > 0, "threads must include outgoing replies");
}
