use super::*;

#[test]
fn persistence_error_preserves_original_debug_and_cause() {
    let original = anyhow::anyhow!("storage unavailable").context("query failed");
    let debug = format!("{original:?}");
    let pretty_debug = format!("{original:#?}");
    let wrapped = InboxPersistenceError::from(original);
    assert_eq!(format!("{wrapped:?}"), debug);
    assert_eq!(format!("{wrapped:#?}"), pretty_debug);
    let restored = wrapped.into_inner();
    assert_eq!(restored.root_cause().to_string(), "storage unavailable");
    assert_eq!(format!("{restored:?}"), debug);
}
