// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

use super::*;
use crate::types::new_jid;

#[tokio::test]
async fn identities_are_trusted_on_first_use() {
    let store = MemoryStore::default();
    assert!(store.is_trusted_identity("111:0", [1; 32]).await.unwrap());
    store.put_identity("111:0", [1; 32]).await.unwrap();
    assert!(store.is_trusted_identity("111:0", [1; 32]).await.unwrap());
    assert!(!store.is_trusted_identity("111:0", [2; 32]).await.unwrap());

    store.put_identity("111:3", [3; 32]).await.unwrap();
    store.put_identity("1112:0", [4; 32]).await.unwrap();
    store.delete_all_identities("111").await.unwrap();
    assert!(store.is_trusted_identity("111:3", [9; 32]).await.unwrap());
    assert!(!store.is_trusted_identity("1112:0", [9; 32]).await.unwrap());
}

#[tokio::test]
async fn pre_keys_are_numbered_from_one_and_marked_uploaded() {
    let store = MemoryStore::default();
    let first_batch = store.get_or_gen_pre_keys(3).await.unwrap();
    assert_eq!(
        first_batch.iter().map(|key| key.key_id).collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    // Not uploaded yet, so the same keys come back.
    let again = store.get_or_gen_pre_keys(2).await.unwrap();
    assert_eq!(again, first_batch[..2]);

    store.mark_pre_keys_as_uploaded(2).await.unwrap();
    assert_eq!(store.uploaded_pre_key_count().await.unwrap(), 2);
    let next_batch = store.get_or_gen_pre_keys(2).await.unwrap();
    assert_eq!(
        next_batch.iter().map(|key| key.key_id).collect::<Vec<_>>(),
        vec![3, 4]
    );
    assert_eq!(store.gen_one_pre_key().await.unwrap().key_id, 5);
    assert_eq!(store.uploaded_pre_key_count().await.unwrap(), 3);

    store.remove_pre_key(1).await.unwrap();
    assert_eq!(store.get_pre_key(1).await.unwrap(), None);
    assert_eq!(
        store.get_pre_key(2).await.unwrap(),
        Some(first_batch[1].clone())
    );
}

#[tokio::test]
async fn migrate_pn_to_lid_moves_sessions_identities_and_sender_keys() {
    let store = MemoryStore::default();
    let pn = new_jid("1234567890", DEFAULT_USER_SERVER);
    let lid = new_jid("98765432101234", HIDDEN_USER_SERVER);
    store
        .put_session("1234567890:0", b"main".to_vec())
        .await
        .unwrap();
    store
        .put_session("1234567890:5", b"web".to_vec())
        .await
        .unwrap();
    store
        .put_session("12345678901:0", b"other".to_vec())
        .await
        .unwrap();
    store.put_identity("1234567890:5", [5; 32]).await.unwrap();
    store
        .put_sender_key("group@g.us", "1234567890:5", b"sender".to_vec())
        .await
        .unwrap();

    store.migrate_pn_to_lid(&pn, &lid).await.unwrap();

    assert_eq!(store.get_session("1234567890:0").await.unwrap(), None);
    assert_eq!(
        store.get_session("98765432101234_1:0").await.unwrap(),
        Some(b"main".to_vec())
    );
    assert_eq!(
        store.get_session("98765432101234_1:5").await.unwrap(),
        Some(b"web".to_vec())
    );
    assert_eq!(
        store.get_session("12345678901:0").await.unwrap(),
        Some(b"other".to_vec())
    );
    assert!(
        !store
            .is_trusted_identity("98765432101234_1:5", [6; 32])
            .await
            .unwrap()
    );
    assert_eq!(
        store
            .get_sender_key("group@g.us", "98765432101234_1:5")
            .await
            .unwrap(),
        Some(b"sender".to_vec())
    );
}

#[tokio::test]
async fn lid_mappings_keep_the_device_and_reject_wrong_servers() {
    let store = MemoryStore::default();
    let pn = new_jid("1234567890", DEFAULT_USER_SERVER);
    let lid = new_jid("98765432101234", HIDDEN_USER_SERVER);
    assert!(matches!(
        store.put_lid_mapping(&pn, &lid).await,
        Err(StoreError::InvalidArgument(_))
    ));
    store.put_lid_mapping(&lid, &pn).await.unwrap();

    let pn_device = Jid {
        device: 3,
        ..pn.clone()
    };
    assert_eq!(
        store.get_lid_for_pn(&pn_device).await.unwrap(),
        Some(Jid {
            device: 3,
            ..lid.clone()
        })
    );
    assert_eq!(
        store
            .get_many_lids_for_pns(&[pn.clone(), new_jid("1", DEFAULT_USER_SERVER)])
            .await
            .unwrap(),
        HashMap::from([(pn.clone(), lid.clone())])
    );

    // A new LID for the same number replaces the old mapping both ways.
    let new_lid = new_jid("55555555555555", HIDDEN_USER_SERVER);
    store.put_lid_mapping(&new_lid, &pn).await.unwrap();
    assert_eq!(store.get_pn_for_lid(&lid).await.unwrap(), None);
    assert_eq!(store.get_lid_for_pn(&pn).await.unwrap(), Some(new_lid));
}

#[tokio::test]
async fn push_names_report_changes() {
    let store = MemoryStore::default();
    let user = new_jid("1234567890", DEFAULT_USER_SERVER);
    assert_eq!(
        store.put_push_name(&user, "Wolf").await.unwrap(),
        (true, String::new())
    );
    assert_eq!(
        store.put_push_name(&user, "Wolf").await.unwrap(),
        (false, String::new())
    );
    assert_eq!(
        store.put_push_name(&user, "W").await.unwrap(),
        (true, "Wolf".to_owned())
    );
    assert_eq!(
        store
            .get_contact(&user)
            .await
            .unwrap()
            .map(|contact| contact.push_name),
        Some("W".to_owned())
    );
}

#[tokio::test]
async fn app_state_mutation_macs_return_the_newest_version() {
    let store = MemoryStore::default();
    store
        .put_app_state_mutation_macs(
            "regular",
            1,
            &[AppStateMutationMac {
                index_mac: b"index".to_vec(),
                value_mac: b"old".to_vec(),
            }],
        )
        .await
        .unwrap();
    store
        .put_app_state_mutation_macs(
            "regular",
            2,
            &[AppStateMutationMac {
                index_mac: b"index".to_vec(),
                value_mac: b"new".to_vec(),
            }],
        )
        .await
        .unwrap();
    assert_eq!(
        store
            .get_app_state_mutation_mac("regular", b"index")
            .await
            .unwrap(),
        Some(b"new".to_vec())
    );
    store
        .delete_app_state_mutation_macs("regular", &[b"index".to_vec()])
        .await
        .unwrap();
    assert_eq!(
        store
            .get_app_state_mutation_mac("regular", b"index")
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        store.get_app_state_version("regular").await.unwrap(),
        (0, [0; 128])
    );
}
