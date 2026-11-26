use super::*;

fn key(id: &str) -> EntityKey<'static> {
    EntityKey(format!("GraphqlSoupChannel:{id}").into())
}

/// A record holding `bytes` of text in one field.
fn record(bytes: usize) -> Record {
    Record {
        fields: BTreeMap::from([("name".to_owned(), CacheValue::String("x".repeat(bytes)))]),
    }
}

fn tier(records: usize, budget: usize) -> HotRecords {
    HotRecords::new(NonZeroUsize::new(records).unwrap(), budget)
}

#[test]
fn the_byte_budget_evicts_the_least_recently_used_records() {
    let size = record_bytes(&key("a"), &record(1_000));
    let mut hot = tier(100, 3 * size);
    for id in ["a", "b", "c"] {
        hot.put(key(id), record(1_000));
    }
    assert!(hot.get(&key("a")).is_some());
    hot.put(key("d"), record(1_000));
    assert!(!hot.contains(&key("b")), "b was the least recently used");
    for id in ["a", "c", "d"] {
        assert!(hot.contains(&key(id)), "{id} stays");
    }
    assert_eq!(
        hot.size(),
        HotTierSize {
            records: 3,
            bytes: 3 * size
        }
    );
}

#[test]
fn the_record_cap_still_binds_small_records() {
    let mut hot = tier(2, HOT_BYTE_BUDGET);
    for id in ["a", "b", "c"] {
        hot.put(key(id), record(10));
    }
    assert!(!hot.contains(&key("a")));
    assert_eq!(hot.size().records, 2);
    assert_eq!(hot.size().bytes, 2 * record_bytes(&key("b"), &record(10)));
}

#[test]
fn a_record_larger_than_the_budget_is_not_kept_and_drops_its_older_copy() {
    let mut hot = tier(100, 10_000);
    hot.put(key("a"), record(100));
    hot.put(key("b"), record(100));
    hot.put(key("a"), record(20_000));
    assert!(!hot.contains(&key("a")));
    assert!(hot.contains(&key("b")), "nothing else is evicted for it");
    assert_eq!(hot.size().bytes, record_bytes(&key("b"), &record(100)));
}

#[test]
fn replacing_popping_and_clearing_keep_the_byte_count() {
    let mut hot = tier(100, HOT_BYTE_BUDGET);
    hot.put(key("a"), record(100));
    hot.put(key("a"), record(500));
    hot.put(key("b"), record(50));
    assert_eq!(
        hot.size().bytes,
        record_bytes(&key("a"), &record(500)) + record_bytes(&key("b"), &record(50))
    );
    assert_eq!(hot.pop(&key("a")), Some(record(500)));
    assert_eq!(hot.size().bytes, record_bytes(&key("b"), &record(50)));
    assert_eq!(hot.pop(&key("a")), None);
    hot.clear();
    assert!(hot.is_empty());
    assert_eq!(
        hot.size(),
        HotTierSize {
            records: 0,
            bytes: 0
        }
    );
}

#[test]
fn the_estimate_counts_what_nested_values_own() {
    let flat = record(0);
    let nested = Record {
        fields: BTreeMap::from([(
            "participants".to_owned(),
            CacheValue::List(vec![
                CacheValue::Object(BTreeMap::from([(
                    "userId".to_owned(),
                    CacheValue::String("u".repeat(40)),
                )]));
                75
            ]),
        )]),
    };
    let per_participant = size_of::<CacheValue>()
        + MAP_ENTRY_BYTES
        + size_of::<String>()
        + size_of::<CacheValue>()
        + "userId".len()
        + 40;
    assert_eq!(
        record_bytes(&key("a"), &nested),
        record_bytes(&key("a"), &flat) + "participants".len() - "name".len() + 75 * per_participant
    );
}
