use super::MessageReadPersistenceError;

#[test]
fn restoring_the_original_error_preserves_debug_text_and_context() {
    let original = anyhow::anyhow!("database unavailable").context("query context");
    let debug = format!("{original:?}");
    let restored = MessageReadPersistenceError::from(original).into_inner();
    assert_eq!(format!("{restored:?}"), debug);
}
