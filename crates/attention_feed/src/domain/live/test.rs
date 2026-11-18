use futures::StreamExt;
use model_entity::EntityType;
use tokio::sync::mpsc;

use super::*;

fn doc() -> model_entity::Entity<'static> {
    EntityType::Document.with_entity_string("d".to_string())
}

fn chat() -> model_entity::Entity<'static> {
    EntityType::Chat.with_entity_string("c".to_string())
}

#[test]
fn batches_deduplicate_keys_in_arrival_order() {
    let mut batch = LiveBatch::default();
    let mut seen = HashSet::new();
    absorb(
        &mut batch,
        &mut seen,
        FeedTrigger::Changed(vec![doc(), chat()]),
    );
    absorb(&mut batch, &mut seen, FeedTrigger::Changed(vec![doc()]));
    assert_eq!(batch.keys, vec![FeedKey::new(doc()), FeedKey::new(chat())]);
    assert!(!batch.invalidated);

    absorb(&mut batch, &mut seen, FeedTrigger::Invalidated);
    assert!(batch.invalidated);
}

#[tokio::test(start_paused = true)]
async fn a_burst_inside_one_window_is_one_batch() {
    let (sender, receiver) = mpsc::channel(8);
    let batches = coalesce(receiver, COALESCE_WINDOW);
    futures::pin_mut!(batches);

    sender
        .send(FeedTrigger::Changed(vec![doc()]))
        .await
        .unwrap();
    sender
        .send(FeedTrigger::Changed(vec![chat(), doc()]))
        .await
        .unwrap();
    let batch = batches.next().await.unwrap();
    assert_eq!(batch.keys, vec![FeedKey::new(doc()), FeedKey::new(chat())]);

    // After the window closes, the next trigger opens a new batch.
    sender.send(FeedTrigger::Invalidated).await.unwrap();
    let batch = batches.next().await.unwrap();
    assert!(batch.keys.is_empty());
    assert!(batch.invalidated);

    drop(sender);
    assert!(batches.next().await.is_none());
}

#[tokio::test(start_paused = true)]
async fn closing_the_triggers_flushes_the_open_batch() {
    let (sender, receiver) = mpsc::channel(8);
    let batches = coalesce(receiver, COALESCE_WINDOW);
    futures::pin_mut!(batches);

    sender
        .send(FeedTrigger::Changed(vec![doc()]))
        .await
        .unwrap();
    drop(sender);
    assert_eq!(
        batches.next().await.unwrap().keys,
        vec![FeedKey::new(doc())]
    );
    assert!(batches.next().await.is_none());
}
