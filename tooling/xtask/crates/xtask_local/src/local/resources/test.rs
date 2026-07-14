use super::*;
use std::collections::HashSet;

/// Every env key across queues, buckets, and tables must be unique — a collision
/// means one resource's value silently clobbers another's.
#[test]
fn env_keys_are_unique() {
    let mut seen = HashSet::new();
    let keys = QUEUES
        .iter()
        .flat_map(|q| q.bindings.iter().map(|(k, _)| *k))
        .chain(BUCKETS.iter().map(|b| b.env_key))
        .chain(TABLES.iter().map(|t| t.env_key));
    for key in keys {
        assert!(seen.insert(key), "duplicate env key in catalog: {key}");
    }
}

/// Resource names must be unique within each kind — a duplicate is almost
/// certainly a copy-paste mistake (LocalStack would just no-op the second
/// create, masking it).
#[test]
fn resource_names_are_unique() {
    let mut queues = HashSet::new();
    for q in QUEUES {
        assert!(queues.insert(q.name), "duplicate queue name: {}", q.name);
    }
    let mut buckets = HashSet::new();
    for b in BUCKETS {
        assert!(buckets.insert(b.name), "duplicate bucket name: {}", b.name);
    }
    let mut tables = HashSet::new();
    for t in TABLES {
        assert!(tables.insert(t.name), "duplicate table name: {}", t.name);
    }
}

/// A queue with no bindings is created in LocalStack but unreachable by any
/// service — almost always a mistake.
#[test]
fn every_queue_is_bound() {
    for q in QUEUES {
        assert!(
            !q.bindings.is_empty(),
            "queue {} has no env binding",
            q.name
        );
    }
}

#[test]
fn webhook_fifo_queue_uses_a_full_url_override() {
    let queue = QUEUES
        .iter()
        .find(|queue| queue.name == macro_queues::WebhookEventQueue::LOCAL)
        .expect("webhook event queue is cataloged");

    assert!(queue.name.ends_with(".fifo"));
    assert_eq!(queue.bindings.len(), 1);
    assert_eq!(
        queue.bindings[0].0,
        macro_queues::WebhookEventQueue::OVERRIDE_ENV_VAR_NAME
    );
    assert!(matches!(queue.bindings[0].1, QueueForm::Url));
    assert_eq!(
        queue.bindings[0].1.value(queue.name),
        "http://localstack:4566/000000000000/webhook-event-queue.fifo"
    );
}
