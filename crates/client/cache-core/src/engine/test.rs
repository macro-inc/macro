use super::*;
use crate::store::InMemoryStorage;

#[test]
fn revision_overflow_is_rejected_without_mutating_storage() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine.revision = u64::MAX.to_string().parse().unwrap();

        let result = engine.clear().await;
        assert!(matches!(result, Err(EngineError::RevisionOverflow)));
        assert_eq!(engine.current_revision().to_string(), u64::MAX.to_string());
        assert!(engine.storage().is_empty());
    });
}
