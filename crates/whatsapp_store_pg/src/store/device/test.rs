use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use uuid::Uuid;
use whatsmeow::proto::wa_adv::AdvSignedDeviceIdentity;
use whatsmeow::store::{SessionStore, StoreError};
use whatsmeow::types::{HIDDEN_USER_SERVER, new_ad_jid, new_jid};

use crate::store::test::{FixedSignatures, open_new_store};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_device_is_unpaired_and_needs_a_jid_to_save(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let device = store.load_device(&FixedSignatures).await.unwrap();
    assert!(!device.initialized);
    assert_eq!(device.id, None);
    assert_eq!(device.signed_pre_key.key_id, 1);
    assert_eq!(device.signed_pre_key.signature, Some([7; 64]));

    let error = device.save().await.unwrap_err();
    assert!(matches!(error, StoreError::InvalidArgument(_)), "{error:?}");
    // Still unpaired: a new device (new keys) each time until one is saved.
    let again = store.load_device(&FixedSignatures).await.unwrap();
    assert!(!again.initialized);
    assert_ne!(again.noise_key, device.noise_key);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_saved_device_loads_back(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let mut device = store.load_device(&FixedSignatures).await.unwrap();
    device.id = Some(new_ad_jid("15551234567", 0, 12));
    device.lid = new_jid("98765", HIDDEN_USER_SERVER);
    device.account = Some(AdvSignedDeviceIdentity {
        details: Some(vec![1, 2, 3]),
        account_signature_key: Some(vec![4; 32]),
        account_signature: Some(vec![5; 64]),
        device_signature: Some(vec![6; 64]),
    });
    device.platform = "android".to_owned();
    device.business_name = "Shop".to_owned();
    device.push_name = "Alice".to_owned();
    device.lid_migration_timestamp = 1_700_000_000;
    device.companion_meta_nonce = "nonce".to_owned();
    device.facebook_uuid = Some(Uuid::now_v7());
    device.save().await.unwrap();

    let loaded = store.load_device(&FixedSignatures).await.unwrap();
    assert!(loaded.initialized);
    assert_eq!(loaded.noise_key, device.noise_key);
    assert_eq!(loaded.identity_key, device.identity_key);
    assert_eq!(loaded.signed_pre_key, device.signed_pre_key);
    assert_eq!(loaded.registration_id, device.registration_id);
    assert_eq!(loaded.adv_secret_key, device.adv_secret_key);
    assert_eq!(loaded.id, device.id);
    assert_eq!(loaded.lid, device.lid);
    assert_eq!(loaded.account, device.account);
    assert_eq!(loaded.platform, "android");
    assert_eq!(loaded.business_name, "Shop");
    assert_eq!(loaded.push_name, "Alice");
    assert_eq!(loaded.lid_migration_timestamp, 1_700_000_000);
    assert_eq!(loaded.companion_meta_nonce, "nonce");
    assert_eq!(loaded.facebook_uuid, device.facebook_uuid);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_the_device_deletes_every_key(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let mut device = store.load_device(&FixedSignatures).await.unwrap();
    device.id = Some(new_ad_jid("15551234567", 0, 12));
    device.save().await.unwrap();
    device
        .sessions
        .put_session("111:0", b"session".to_vec())
        .await
        .unwrap();

    device.delete().await.unwrap();
    assert!(device.deleted);
    let remaining = sqlx::query_scalar!(
        r#"
        SELECT
            (SELECT COUNT(*) FROM whatsapp_device WHERE account_id = $1)
            + (SELECT COUNT(*) FROM whatsapp_store_value WHERE account_id = $1)
            AS "count!"
        "#,
        store.account_id(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(remaining, 0);
    // The store itself is useless now; its writes fail.
    assert!(store.put_session("111:0", b"late".to_vec()).await.is_err());
}
