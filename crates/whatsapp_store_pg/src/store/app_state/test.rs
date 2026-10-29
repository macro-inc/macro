use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use whatsmeow::store::{AppStateMutationMac, AppStateStore, AppStateSyncKey, AppStateSyncKeyStore};

use crate::store::test::open_new_store;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sync_keys_are_only_replaced_by_newer_ones(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    assert_eq!(
        store.get_latest_app_state_sync_key_id().await.unwrap(),
        None
    );
    assert_eq!(store.get_all_app_state_sync_keys().await.unwrap(), vec![]);

    let older = AppStateSyncKey {
        data: vec![1; 32],
        fingerprint: vec![1, 2, 3],
        timestamp: 1_000,
    };
    let newer = AppStateSyncKey {
        data: vec![2; 32],
        fingerprint: vec![4, 5, 6],
        timestamp: 2_000,
    };
    store
        .put_app_state_sync_key(&[0xaa, 0x01], older.clone())
        .await
        .unwrap();
    store
        .put_app_state_sync_key(&[0xbb, 0x02], newer.clone())
        .await
        .unwrap();
    assert_eq!(
        store.get_app_state_sync_key(&[0xaa, 0x01]).await.unwrap(),
        Some(older.clone())
    );
    assert_eq!(store.get_app_state_sync_key(&[0xcc]).await.unwrap(), None);
    assert_eq!(
        store.get_latest_app_state_sync_key_id().await.unwrap(),
        Some(vec![0xbb, 0x02])
    );
    assert_eq!(
        store.get_all_app_state_sync_keys().await.unwrap(),
        vec![newer.clone(), older.clone()]
    );

    // A key with an older or equal timestamp doesn't replace the stored one.
    let stale = AppStateSyncKey {
        data: vec![9; 32],
        fingerprint: vec![9],
        timestamp: 2_000,
    };
    store
        .put_app_state_sync_key(&[0xbb, 0x02], stale)
        .await
        .unwrap();
    assert_eq!(
        store.get_app_state_sync_key(&[0xbb, 0x02]).await.unwrap(),
        Some(newer)
    );
    let fresh = AppStateSyncKey {
        data: vec![3; 32],
        fingerprint: vec![7],
        timestamp: 3_000,
    };
    store
        .put_app_state_sync_key(&[0xaa, 0x01], fresh.clone())
        .await
        .unwrap();
    assert_eq!(
        store.get_app_state_sync_key(&[0xaa, 0x01]).await.unwrap(),
        Some(fresh)
    );
    assert_eq!(
        store.get_latest_app_state_sync_key_id().await.unwrap(),
        Some(vec![0xaa, 0x01])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn app_state_versions_start_at_zero(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    assert_eq!(
        store.get_app_state_version("regular").await.unwrap(),
        (0, [0; 128])
    );

    let mut hash = [0; 128];
    hash[0] = 1;
    hash[127] = 255;
    store
        .put_app_state_version("regular", 42, hash)
        .await
        .unwrap();
    store
        .put_app_state_version("critical_block", 7, [3; 128])
        .await
        .unwrap();
    assert_eq!(
        store.get_app_state_version("regular").await.unwrap(),
        (42, hash)
    );

    store.delete_app_state_version("regular").await.unwrap();
    assert_eq!(
        store.get_app_state_version("regular").await.unwrap(),
        (0, [0; 128])
    );
    assert_eq!(
        store.get_app_state_version("critical_block").await.unwrap(),
        (7, [3; 128])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_newest_mutation_mac_wins_and_deletes_go_by_index(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let mutations: Vec<AppStateMutationMac> = (0..1000u16)
        .map(|index| AppStateMutationMac {
            index_mac: index.to_be_bytes().to_vec(),
            value_mac: vec![1, index as u8],
        })
        .collect();
    store
        .put_app_state_mutation_macs("regular", 1, &mutations)
        .await
        .unwrap();
    store
        .put_app_state_mutation_macs(
            "regular",
            2,
            &[AppStateMutationMac {
                index_mac: vec![0, 5],
                value_mac: vec![2, 5],
            }],
        )
        .await
        .unwrap();
    store
        .put_app_state_mutation_macs("regular", 3, &[])
        .await
        .unwrap();

    assert_eq!(
        store
            .get_app_state_mutation_mac("regular", &[0, 5])
            .await
            .unwrap(),
        Some(vec![2, 5])
    );
    assert_eq!(
        store
            .get_app_state_mutation_mac("regular", &[3, 231])
            .await
            .unwrap(),
        Some(vec![1, 231])
    );
    assert_eq!(
        store
            .get_app_state_mutation_mac("critical_block", &[0, 5])
            .await
            .unwrap(),
        None
    );

    store
        .delete_app_state_mutation_macs("regular", &[vec![0, 5], vec![0, 6]])
        .await
        .unwrap();
    assert_eq!(
        store
            .get_app_state_mutation_mac("regular", &[0, 5])
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        store
            .get_app_state_mutation_mac("regular", &[0, 6])
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        store
            .get_app_state_mutation_mac("regular", &[0, 7])
            .await
            .unwrap(),
        Some(vec![1, 7])
    );
}
