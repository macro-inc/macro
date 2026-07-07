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
