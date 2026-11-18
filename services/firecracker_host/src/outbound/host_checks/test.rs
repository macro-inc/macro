use super::{HostChecks, dataset_usage, pool_health, storage_usage};
use crate::domain::health::HealthCheck;
use crate::domain::metrics::StorageUsage;

#[test]
fn only_an_online_pool_is_healthy() {
    assert!(pool_health("tank", "ONLINE\n").healthy);
    let degraded = pool_health("tank", "DEGRADED\n");
    assert!(!degraded.healthy);
    assert_eq!(degraded.check, HealthCheck::StoragePool);
    assert_eq!(degraded.detail.as_deref(), Some("pool tank is DEGRADED"));
}

#[test]
fn zfs_list_output_is_the_dataset_trees_usage() {
    assert_eq!(
        dataset_usage("123456\t7890\n"),
        Some(StorageUsage {
            used_bytes: 123_456,
            available_bytes: 7890,
        })
    );
    assert_eq!(dataset_usage("-\t-\n"), None);
}

#[test]
fn storage_usage_reads_the_filesystem() {
    let directory = tempfile::tempdir().unwrap();
    let usage = storage_usage(directory.path()).unwrap();
    assert!(usage.available_bytes > 0);
}

#[tokio::test]
async fn a_durable_directory_that_takes_writes_passes_and_a_missing_one_fails() {
    let directory = tempfile::tempdir().unwrap();
    let healthy = HostChecks {
        durable_dir: directory.path().to_owned(),
        nft_tables: Vec::new(),
        zfs_dataset: None,
    };
    let results = healthy.run().await;
    assert!(
        results.checks.iter().all(|check| check.healthy),
        "{results:?}"
    );
    assert!(!directory.path().join(".health-probe").exists());

    let missing = HostChecks {
        durable_dir: directory.path().join("absent"),
        ..healthy
    };
    let results = missing.run().await;
    let writable = results
        .checks
        .iter()
        .find(|check| check.check == HealthCheck::StoreWritable)
        .unwrap();
    assert!(!writable.healthy);
}
