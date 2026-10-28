use std::collections::HashMap;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use whatsmeow::store::{IdentityStore, PreKeyStore, SenderKeyStore, SessionStore, StoreError};
use whatsmeow::types::{DEFAULT_USER_SERVER, HIDDEN_USER_SERVER, new_jid};
use whatsmeow::util::keys::new_key_pair_from_private_key;

use crate::store::test::open_new_store;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn identities_are_trusted_on_first_use_and_deleted_by_user(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    assert!(store.is_trusted_identity("111:0", [1; 32]).await.unwrap());
    store.put_identity("111:0", [1; 32]).await.unwrap();
    assert!(store.is_trusted_identity("111:0", [1; 32]).await.unwrap());
    assert!(!store.is_trusted_identity("111:0", [2; 32]).await.unwrap());

    store.put_identity("111:3", [3; 32]).await.unwrap();
    store.put_identity("1112:0", [4; 32]).await.unwrap();
    // `_` is a LIKE wildcard: "111_1:0" must not match the prefix "1111:".
    store.put_identity("111_1:0", [5; 32]).await.unwrap();
    store.put_identity("1111:0", [6; 32]).await.unwrap();
    store.delete_all_identities("111").await.unwrap();
    store.delete_all_identities("111_1").await.unwrap();
    assert!(store.is_trusted_identity("111:0", [9; 32]).await.unwrap());
    assert!(store.is_trusted_identity("111:3", [9; 32]).await.unwrap());
    assert!(store.is_trusted_identity("111_1:0", [9; 32]).await.unwrap());
    assert!(!store.is_trusted_identity("1112:0", [9; 32]).await.unwrap());
    assert!(!store.is_trusted_identity("1111:0", [9; 32]).await.unwrap());

    store.delete_identity("1112:0").await.unwrap();
    assert!(store.is_trusted_identity("1112:0", [9; 32]).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sessions_round_trip_singly_and_in_batches(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    assert_eq!(store.get_session("111:0").await.unwrap(), None);
    assert!(!store.has_session("111:0").await.unwrap());

    store.put_session("111:0", b"one".to_vec()).await.unwrap();
    assert!(store.has_session("111:0").await.unwrap());
    store
        .put_session("111:0", b"one again".to_vec())
        .await
        .unwrap();
    assert_eq!(
        store.get_session("111:0").await.unwrap(),
        Some(b"one again".to_vec())
    );

    store
        .put_many_sessions(HashMap::from([
            ("111:1".to_owned(), b"two".to_vec()),
            ("222:0".to_owned(), b"three".to_vec()),
        ]))
        .await
        .unwrap();
    let many = store
        .get_many_sessions(&["111:0".to_owned(), "111:1".to_owned(), "333:0".to_owned()])
        .await
        .unwrap();
    assert_eq!(
        many,
        HashMap::from([
            ("111:0".to_owned(), Some(b"one again".to_vec())),
            ("111:1".to_owned(), Some(b"two".to_vec())),
            ("333:0".to_owned(), None),
        ])
    );
    assert_eq!(store.get_many_sessions(&[]).await.unwrap(), HashMap::new());

    store.delete_all_sessions("111").await.unwrap();
    assert_eq!(store.get_session("111:0").await.unwrap(), None);
    assert_eq!(store.get_session("111:1").await.unwrap(), None);
    assert_eq!(
        store.get_session("222:0").await.unwrap(),
        Some(b"three".to_vec())
    );
    store.delete_session("222:0").await.unwrap();
    assert!(!store.has_session("222:0").await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn migrate_pn_to_lid_moves_sessions_identities_and_sender_keys(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let pn = new_jid("1234567890", DEFAULT_USER_SERVER);
    let lid = new_jid("98765432101234", HIDDEN_USER_SERVER);
    store
        .put_session("1234567890:0", b"main".to_vec())
        .await
        .unwrap();
    store
        .put_session("1234567890:5", b"companion".to_vec())
        .await
        .unwrap();
    store
        .put_session("98765432101234_1:0", b"stale lid".to_vec())
        .await
        .unwrap();
    store.put_identity("1234567890:0", [1; 32]).await.unwrap();
    store
        .put_sender_key("group@g.us", "1234567890:0", b"sender".to_vec())
        .await
        .unwrap();
    store
        .put_session("12345678901:0", b"someone else".to_vec())
        .await
        .unwrap();

    store.migrate_pn_to_lid(&pn, &lid).await.unwrap();

    assert_eq!(store.get_session("1234567890:0").await.unwrap(), None);
    assert_eq!(store.get_session("1234567890:5").await.unwrap(), None);
    assert_eq!(
        store.get_session("98765432101234_1:0").await.unwrap(),
        Some(b"main".to_vec())
    );
    assert_eq!(
        store.get_session("98765432101234_1:5").await.unwrap(),
        Some(b"companion".to_vec())
    );
    assert!(
        store
            .is_trusted_identity("1234567890:0", [9; 32])
            .await
            .unwrap()
    );
    assert!(
        !store
            .is_trusted_identity("98765432101234_1:0", [9; 32])
            .await
            .unwrap()
    );
    assert_eq!(
        store
            .get_sender_key("group@g.us", "98765432101234_1:0")
            .await
            .unwrap(),
        Some(b"sender".to_vec())
    );
    assert_eq!(
        store
            .get_sender_key("group@g.us", "1234567890:0")
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        store.get_session("12345678901:0").await.unwrap(),
        Some(b"someone else".to_vec())
    );

    // Migrated once per process: a session stored under the phone number
    // afterwards stays where it is.
    store
        .put_session("1234567890:0", b"new".to_vec())
        .await
        .unwrap();
    store.migrate_pn_to_lid(&pn, &lid).await.unwrap();
    assert_eq!(
        store.get_session("1234567890:0").await.unwrap(),
        Some(b"new".to_vec())
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pre_keys_are_numbered_from_one_and_marked_uploaded(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let first_batch = store.get_or_gen_pre_keys(3).await.unwrap();
    assert_eq!(
        first_batch.iter().map(|key| key.key_id).collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    for key in &first_batch {
        assert_eq!(
            key.key_pair,
            new_key_pair_from_private_key(key.key_pair.private)
        );
        assert_eq!(key.signature, None);
    }
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
    assert_eq!(next_batch[0], first_batch[2]);
    assert_eq!(store.gen_one_pre_key().await.unwrap().key_id, 5);
    assert_eq!(store.uploaded_pre_key_count().await.unwrap(), 3);

    store.remove_pre_key(1).await.unwrap();
    assert_eq!(store.get_pre_key(1).await.unwrap(), None);
    assert_eq!(
        store.get_pre_key(2).await.unwrap(),
        Some(first_batch[1].clone())
    );
    // IDs keep counting up after removals.
    store.remove_pre_key(5).await.unwrap();
    assert_eq!(store.gen_one_pre_key().await.unwrap().key_id, 5);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_large_pre_key_batch_is_generated_and_uploaded_at_once(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let keys = store.get_or_gen_pre_keys(5000).await.unwrap();
    assert_eq!(
        keys.iter().map(|key| key.key_id).collect::<Vec<_>>(),
        (1..=5000).collect::<Vec<_>>()
    );
    assert_eq!(store.get_or_gen_pre_keys(5000).await.unwrap(), keys);

    store.mark_pre_keys_as_uploaded(5000).await.unwrap();
    assert_eq!(store.uploaded_pre_key_count().await.unwrap(), 5000);
    assert_eq!(
        store.get_pre_key(4321).await.unwrap(),
        Some(keys[4320].clone())
    );
    assert_eq!(store.get_or_gen_pre_keys(1).await.unwrap()[0].key_id, 5001);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sender_keys_are_per_group_and_sender(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    store
        .put_sender_key("1@g.us", "111:0", b"first".to_vec())
        .await
        .unwrap();
    store
        .put_sender_key("2@g.us", "111:0", b"second".to_vec())
        .await
        .unwrap();
    store
        .put_sender_key("1@g.us", "111:0", b"first again".to_vec())
        .await
        .unwrap();
    assert_eq!(
        store.get_sender_key("1@g.us", "111:0").await.unwrap(),
        Some(b"first again".to_vec())
    );
    assert_eq!(
        store.get_sender_key("2@g.us", "111:0").await.unwrap(),
        Some(b"second".to_vec())
    );
    assert_eq!(store.get_sender_key("1@g.us", "222:0").await.unwrap(), None);

    let error = store
        .put_sender_key("1@g.us", "111|0", b"ambiguous".to_vec())
        .await
        .unwrap_err();
    assert!(matches!(error, StoreError::InvalidArgument(_)), "{error:?}");
}
