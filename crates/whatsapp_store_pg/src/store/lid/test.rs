use std::collections::HashMap;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use whatsmeow::store::{LidMapping, LidStore, StoreError};
use whatsmeow::types::{
    DEFAULT_USER_SERVER, GROUP_SERVER, HIDDEN_USER_SERVER, new_ad_jid, new_jid,
};

use crate::store::test::open_new_store;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mappings_resolve_both_ways_keeping_the_device(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let pn = new_jid("111", DEFAULT_USER_SERVER);
    let lid = new_jid("98765", HIDDEN_USER_SERVER);
    assert_eq!(store.get_lid_for_pn(&pn).await.unwrap(), None);

    store.put_lid_mapping(&lid, &pn).await.unwrap();
    assert_eq!(store.get_lid_for_pn(&pn).await.unwrap(), Some(lid.clone()));
    assert_eq!(store.get_pn_for_lid(&lid).await.unwrap(), Some(pn.clone()));

    let pn_device = new_ad_jid("111", 0, 4);
    let mut lid_device = lid.clone();
    lid_device.device = 4;
    assert_eq!(
        store.get_lid_for_pn(&pn_device).await.unwrap(),
        Some(lid_device.clone())
    );
    assert_eq!(
        store.get_pn_for_lid(&lid_device).await.unwrap(),
        Some(pn_device)
    );

    assert!(matches!(
        store.get_lid_for_pn(&lid).await.unwrap_err(),
        StoreError::InvalidArgument(_)
    ));
    assert!(matches!(
        store.get_pn_for_lid(&pn).await.unwrap_err(),
        StoreError::InvalidArgument(_)
    ));
    assert!(matches!(
        store.put_lid_mapping(&pn, &lid).await.unwrap_err(),
        StoreError::InvalidArgument(_)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_mapping_replaces_older_ones_of_either_side(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let pn = new_jid("111", DEFAULT_USER_SERVER);
    let other_pn = new_jid("222", DEFAULT_USER_SERVER);
    let lid = new_jid("98765", HIDDEN_USER_SERVER);
    let new_lid = new_jid("55555", HIDDEN_USER_SERVER);

    store.put_lid_mapping(&lid, &pn).await.unwrap();
    // The phone number got a new LID: the old LID maps to nothing.
    store.put_lid_mapping(&new_lid, &pn).await.unwrap();
    assert_eq!(
        store.get_lid_for_pn(&pn).await.unwrap(),
        Some(new_lid.clone())
    );
    assert_eq!(store.get_pn_for_lid(&lid).await.unwrap(), None);
    // The LID moved to another phone number: the old number maps to nothing.
    store.put_lid_mapping(&new_lid, &other_pn).await.unwrap();
    assert_eq!(
        store.get_pn_for_lid(&new_lid).await.unwrap(),
        Some(other_pn.clone())
    );
    assert_eq!(store.get_lid_for_pn(&pn).await.unwrap(), None);
    assert_eq!(
        store.get_lid_for_pn(&other_pn).await.unwrap(),
        Some(new_lid)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn batches_skip_invalid_mappings_and_apply_in_order(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let pns: Vec<_> = (0..300)
        .map(|index| new_jid(&format!("1555{index:04}"), DEFAULT_USER_SERVER))
        .collect();
    let lids: Vec<_> = (0..300)
        .map(|index| new_jid(&format!("9000{index:04}"), HIDDEN_USER_SERVER))
        .collect();
    let mut mappings: Vec<LidMapping> = pns
        .iter()
        .zip(&lids)
        .map(|(pn, lid)| LidMapping {
            lid: lid.clone(),
            pn: pn.clone(),
        })
        .collect();
    mappings.push(LidMapping {
        lid: new_jid("123-456", GROUP_SERVER),
        pn: pns[0].clone(),
    });
    // A later mapping in the same batch moves the first phone number.
    let moved_lid = new_jid("77777", HIDDEN_USER_SERVER);
    mappings.push(LidMapping {
        lid: moved_lid.clone(),
        pn: pns[0].clone(),
    });
    store.put_many_lid_mappings(&mappings).await.unwrap();
    store.put_many_lid_mappings(&[]).await.unwrap();

    assert_eq!(
        store.get_lid_for_pn(&pns[0]).await.unwrap(),
        Some(moved_lid)
    );
    assert_eq!(store.get_pn_for_lid(&lids[0]).await.unwrap(), None);
    assert_eq!(
        store.get_pn_for_lid(&lids[299]).await.unwrap(),
        Some(pns[299].clone())
    );

    let unknown = new_jid("1999", DEFAULT_USER_SERVER);
    let device = new_ad_jid("15550007", 0, 2);
    let mut device_lid = lids[7].clone();
    device_lid.device = 2;
    let many = store
        .get_many_lids_for_pns(&[pns[1].clone(), unknown, device.clone(), lids[2].clone()])
        .await
        .unwrap();
    assert_eq!(
        many,
        HashMap::from([(pns[1].clone(), lids[1].clone()), (device, device_lid)])
    );
}
