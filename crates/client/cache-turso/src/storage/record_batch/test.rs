use super::*;
use pollster::block_on;

fn key(value: &str) -> EntityKey<'static> {
    EntityKey(value.to_owned().into())
}

fn record(value: &str) -> Record {
    Record {
        fields: [(
            "value".into(),
            cache_core::value::CacheValue::String(value.into()),
        )]
        .into(),
    }
}

#[test]
fn batches_preserve_order_duplicates_missing_keys_and_root_across_boundaries() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("record-batches").unwrap();
        let entries: Vec<_> = (0..BATCH_SIZE * 3 + 1)
            .map(|index| {
                let typename = if index % 2 == 0 { "Thing" } else { "Other" };
                (
                    key(&format!("{typename}:{index}")),
                    record(&index.to_string()),
                )
            })
            .chain([(EntityKey::root(), record("root"))])
            .collect();
        storage.put_batch(entries.clone()).await.unwrap();
        let mut requested = entries
            .iter()
            .rev()
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>();
        requested.insert(BATCH_SIZE - 1, key("Missing:absent"));
        requested.insert(BATCH_SIZE, requested[0].clone());
        requested.push(key("Thing:1")); // Same id, different typename.
        requested.push(key("Thing:0"));
        let expected = requested
            .iter()
            .map(|key| {
                entries
                    .iter()
                    .find(|(stored, _)| stored == key)
                    .map(|(_, record)| record.clone())
            })
            .collect::<Vec<_>>();
        assert_eq!(storage.get_batch(&requested).await.unwrap(), expected);
        assert!(storage.get_batch(&[]).await.unwrap().is_empty());
        assert_eq!(
            storage.get_batch(&[EntityKey::root()]).await.unwrap(),
            vec![Some(record("root"))]
        );
    });
}

#[test]
fn batch_uses_indexed_point_lookups_in_a_large_population() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("record-batch-cost").unwrap();
        storage
            .put_batch(
                (0..10_000)
                    .map(|index| (key(&format!("Thing:{index:05}")), record("value")))
                    .collect(),
            )
            .await
            .unwrap();
        let connection = storage.connection();
        let mut statement = driver::prepare(&connection, &sql(BATCH_SIZE)).unwrap();
        let parameters = (0..BATCH_SIZE)
            .flat_map(|index| [text("Thing"), text(&format!("{:05}", index * 71))])
            .collect();
        let rows = driver::query_prepared(&mut statement, parameters).unwrap();
        assert_eq!(rows.len(), BATCH_SIZE);
        assert!(rows.iter().all(|row| matches!(&row[1], Value::Blob(_))));
        let steps = statement.metrics().vm_steps;
        assert!(
            steps < BATCH_SIZE as u64 * 100,
            "{steps} VM steps: expected indexed lookups"
        );
    });
}

#[test]
fn corrupt_batch_payload_latches_storage_health() {
    block_on(async {
        let storage = TursoStorage::open_in_memory("record-batch-corruption").unwrap();
        driver::execute(
            &storage.connection(),
            RECORD_UPSERT,
            vec![text("Thing"), text("bad"), Value::from_blob(vec![0xff])],
        )
        .unwrap();
        let error = storage
            .get_batch(&[key("Thing:absent"), key("Thing:bad")])
            .await
            .unwrap_err();
        assert_eq!(
            error.physical_reset_reason(),
            Some(PhysicalResetReason::Codec)
        );
        let error = storage.get_batch(&[]).await.unwrap_err();
        assert_eq!(
            error.physical_reset_reason(),
            Some(PhysicalResetReason::Codec)
        );
    });
}
