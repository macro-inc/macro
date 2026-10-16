use super::*;
use model_entity::EntityType;

#[test]
fn batches_deduplicate_keys_in_arrival_order() {
    let doc = EntityType::Document.with_entity_string("d".to_string());
    let chat = EntityType::Chat.with_entity_string("c".to_string());
    let mut batch = TriggerBatch::default();
    batch.absorb(WorkFeedTrigger::Changed(vec![doc.clone(), chat.clone()]));
    batch.absorb(WorkFeedTrigger::Changed(vec![doc.clone()]));
    assert_eq!(
        batch.keys,
        vec![WorkFeedItemKey::new(doc), WorkFeedItemKey::new(chat)]
    );
    assert!(!batch.invalidated);

    batch.absorb(WorkFeedTrigger::Invalidated);
    assert!(batch.invalidated);
}
