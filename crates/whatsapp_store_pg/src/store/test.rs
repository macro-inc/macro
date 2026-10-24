//! Opening, encryption at rest, fencing and concurrency, against a real
//! Postgres. The fixtures here are shared with the per-store tests.

use std::sync::Arc;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use uuid::Uuid;
use whatsmeow::signal::CurveSignatures;
use whatsmeow::store::{IdentityStore, PreKeyStore, SessionStore};

use super::PgWhatsAppStore;
use crate::error::{WhatsAppStoreError, is_fenced};
use crate::kms::FakeWhatsAppKms;

pub(crate) const KMS_KEY_ID: &str = "arn:aws:kms:us-east-1:123456789012:key/whatsapp-test";

/// Signatures are only used to sign a new device's prekey here.
pub(crate) struct FixedSignatures;

impl CurveSignatures for FixedSignatures {
    fn calculate_signature(&self, _private_key: &[u8; 32], _message: &[u8]) -> [u8; 64] {
        [7; 64]
    }

    fn verify_signature(
        &self,
        _public_key: &[u8; 32],
        _message: &[u8],
        _signature: &[u8; 64],
    ) -> bool {
        true
    }
}

/// A Macro user: a `macro_user` identity and the `"User"` profile the
/// account references.
pub(crate) async fn insert_user(pool: &Pool<Postgres>, user_id: &str) {
    let email = format!("{user_id}@example.com");
    sqlx::query!(
        r#"
        WITH new_macro_user AS (
            INSERT INTO macro_user (id, username, email, stripe_customer_id)
            VALUES (gen_random_uuid(), $2, $2, $3)
            RETURNING id
        )
        INSERT INTO "User" ("id", "email", "macro_user_id")
        SELECT $1, $2, new_macro_user.id FROM new_macro_user
        "#,
        user_id,
        email,
        format!("stripe_{user_id}"),
    )
    .execute(pool)
    .await
    .expect("the user is new");
}

/// A Macro user and a linked account of theirs, at lease epoch 0.
pub(crate) async fn insert_account(pool: &Pool<Postgres>, user_id: &str) -> Uuid {
    insert_user(pool, user_id).await;
    let account_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO whatsapp_linked_account (id, user_id, state)
        VALUES ($1, $2, 'pairing')
        "#,
        account_id,
        user_id,
    )
    .execute(pool)
    .await
    .expect("the account is new");
    account_id
}

/// A store of a new account, at lease epoch 0.
pub(crate) async fn open_new_store(pool: &Pool<Postgres>) -> Arc<PgWhatsAppStore> {
    let account_id = insert_account(pool, "macro|whatsapp-store-owner").await;
    let kms = FakeWhatsAppKms::new(KMS_KEY_ID);
    Arc::new(
        PgWhatsAppStore::open(pool.clone(), account_id, 0, &kms)
            .await
            .expect("the account is new"),
    )
}

async fn set_lease_epoch(pool: &Pool<Postgres>, account_id: Uuid, lease_epoch: i64) {
    sqlx::query!(
        "UPDATE whatsapp_linked_account SET lease_epoch = $2 WHERE id = $1",
        account_id,
        lease_epoch,
    )
    .execute(pool)
    .await
    .expect("the account exists");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_data_key_is_generated_once_and_unwrapped_on_every_later_open(pool: Pool<Postgres>) {
    let account_id = insert_account(&pool, "macro|data-key").await;
    let kms = FakeWhatsAppKms::new(KMS_KEY_ID);

    let first = PgWhatsAppStore::open(pool.clone(), account_id, 0, &kms)
        .await
        .unwrap();
    first
        .put_session("111:0", b"session".to_vec())
        .await
        .unwrap();
    assert_eq!((kms.generate_calls(), kms.decrypt_calls()), (1, 0));

    let second = PgWhatsAppStore::open(pool.clone(), account_id, 0, &kms)
        .await
        .unwrap();
    assert_eq!((kms.generate_calls(), kms.decrypt_calls()), (1, 1));
    assert_eq!(
        second.get_session("111:0").await.unwrap(),
        Some(b"session".to_vec())
    );
    // Reads and writes never call KMS again.
    second
        .put_session("222:0", b"other".to_vec())
        .await
        .unwrap();
    assert_eq!((kms.generate_calls(), kms.decrypt_calls()), (1, 1));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_first_opens_agree_on_one_data_key(pool: Pool<Postgres>) {
    let account_id = insert_account(&pool, "macro|first-opens").await;
    let kms = FakeWhatsAppKms::new(KMS_KEY_ID);

    let (first, second) = tokio::join!(
        PgWhatsAppStore::open(pool.clone(), account_id, 0, &kms),
        PgWhatsAppStore::open(pool.clone(), account_id, 0, &kms),
    );
    let (first, second) = (first.unwrap(), second.unwrap());

    first
        .put_session("111:0", b"from first".to_vec())
        .await
        .unwrap();
    second
        .put_session("222:0", b"from second".to_vec())
        .await
        .unwrap();
    assert_eq!(
        second.get_session("111:0").await.unwrap(),
        Some(b"from first".to_vec())
    );
    assert_eq!(
        first.get_session("222:0").await.unwrap(),
        Some(b"from second".to_vec())
    );
    let devices = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM whatsapp_device WHERE account_id = $1"#,
        account_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(devices, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn values_are_stored_as_ciphertext(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let session = b"a very recognizable session record".to_vec();
    store.put_session("111:0", session.clone()).await.unwrap();

    let stored = sqlx::query!(
        r#"
        SELECT nonce, value
        FROM whatsapp_store_value
        WHERE account_id = $1 AND store = 'session' AND key = '111:0'
        "#,
        store.account_id(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored.nonce.len(), 12);
    // Ciphertext plus the 16-byte tag.
    assert_eq!(stored.value.len(), session.len() + 16);
    assert!(
        !stored
            .value
            .windows(8)
            .any(|window| session.windows(8).any(|plain| plain == window)),
        "no run of the plaintext appears in the stored value"
    );

    // A fresh nonce per write: writing the same value again changes both.
    store.put_session("111:0", session.clone()).await.unwrap();
    let rewritten = sqlx::query!(
        r#"
        SELECT nonce, value
        FROM whatsapp_store_value
        WHERE account_id = $1 AND store = 'session' AND key = '111:0'
        "#,
        store.account_id(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_ne!(rewritten.nonce, stored.nonce);
    assert_ne!(rewritten.value, stored.value);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_value_moved_to_another_key_does_not_decrypt(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    store.put_session("111:0", b"alice".to_vec()).await.unwrap();
    store.put_session("222:0", b"bob".to_vec()).await.unwrap();

    sqlx::query!(
        r#"
        UPDATE whatsapp_store_value AS target
        SET nonce = source.nonce, value = source.value
        FROM whatsapp_store_value AS source
        WHERE target.account_id = $1 AND target.store = 'session' AND target.key = '222:0'
          AND source.account_id = $1 AND source.store = 'session' AND source.key = '111:0'
        "#,
        store.account_id(),
    )
    .execute(&pool)
    .await
    .unwrap();

    let error = store.get_session("222:0").await.unwrap_err();
    let whatsmeow::store::StoreError::Internal(report) = &error else {
        panic!("unexpected error: {error:?}");
    };
    assert!(
        matches!(
            report.downcast_current_context::<WhatsAppStoreError>(),
            Some(WhatsAppStoreError::Decrypt)
        ),
        "unexpected error: {error:?}"
    );
    assert_eq!(
        store.get_session("111:0").await.unwrap(),
        Some(b"alice".to_vec())
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_value_moved_to_another_store_does_not_decrypt(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    store.put_identity("111:0", [9; 32]).await.unwrap();

    sqlx::query!(
        r#"
        INSERT INTO whatsapp_store_value (account_id, store, key, nonce, value)
        SELECT account_id, 'session', key, nonce, value
        FROM whatsapp_store_value
        WHERE account_id = $1 AND store = 'identity' AND key = '111:0'
        "#,
        store.account_id(),
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(store.get_session("111:0").await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_value_moved_to_another_account_does_not_decrypt(pool: Pool<Postgres>) {
    let kms = FakeWhatsAppKms::new(KMS_KEY_ID);
    let alice_account = insert_account(&pool, "macro|alice").await;
    let bob_account = insert_account(&pool, "macro|bob").await;
    let alice = PgWhatsAppStore::open(pool.clone(), alice_account, 0, &kms)
        .await
        .unwrap();
    let bob = PgWhatsAppStore::open(pool.clone(), bob_account, 0, &kms)
        .await
        .unwrap();
    alice
        .put_session("111:0", b"alice's".to_vec())
        .await
        .unwrap();

    sqlx::query!(
        r#"
        INSERT INTO whatsapp_store_value (account_id, store, key, nonce, value)
        SELECT $2, store, key, nonce, value
        FROM whatsapp_store_value
        WHERE account_id = $1 AND store = 'session' AND key = '111:0'
        "#,
        alice_account,
        bob_account,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(bob.get_session("111:0").await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_data_key_moved_to_another_account_does_not_unwrap(pool: Pool<Postgres>) {
    let kms = FakeWhatsAppKms::new(KMS_KEY_ID);
    let alice_account = insert_account(&pool, "macro|alice").await;
    let bob_account = insert_account(&pool, "macro|bob").await;
    PgWhatsAppStore::open(pool.clone(), alice_account, 0, &kms)
        .await
        .unwrap();
    PgWhatsAppStore::open(pool.clone(), bob_account, 0, &kms)
        .await
        .unwrap();

    sqlx::query!(
        r#"
        UPDATE whatsapp_device AS bob
        SET data_key_ciphertext = alice.data_key_ciphertext
        FROM whatsapp_device AS alice
        WHERE bob.account_id = $2 AND alice.account_id = $1
        "#,
        alice_account,
        bob_account,
    )
    .execute(&pool)
    .await
    .unwrap();

    let error = PgWhatsAppStore::open(pool.clone(), bob_account, 0, &kms)
        .await
        .unwrap_err();
    assert!(matches!(error, WhatsAppStoreError::Kms(_)), "{error:?}");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_data_key_does_not_unwrap_for_another_owner_or_kms_key(pool: Pool<Postgres>) {
    let kms = FakeWhatsAppKms::new(KMS_KEY_ID);
    let account_id = insert_account(&pool, "macro|owner").await;
    PgWhatsAppStore::open(pool.clone(), account_id, 0, &kms)
        .await
        .unwrap();

    // Another KMS key (or another key altogether) refuses the wrapped key.
    let other_kms = FakeWhatsAppKms::new(KMS_KEY_ID);
    let error = PgWhatsAppStore::open(pool.clone(), account_id, 0, &other_kms)
        .await
        .unwrap_err();
    assert!(matches!(error, WhatsAppStoreError::Kms(_)), "{error:?}");

    // The account handed to another user: the context no longer matches.
    insert_user(&pool, "macro|new-owner").await;
    sqlx::query!(
        "UPDATE whatsapp_linked_account SET user_id = 'macro|new-owner' WHERE id = $1",
        account_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let error = PgWhatsAppStore::open(pool.clone(), account_id, 0, &kms)
        .await
        .unwrap_err();
    assert!(matches!(error, WhatsAppStoreError::Kms(_)), "{error:?}");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unknown_encryption_version_is_refused_before_calling_kms(pool: Pool<Postgres>) {
    let kms = FakeWhatsAppKms::new(KMS_KEY_ID);
    let account_id = insert_account(&pool, "macro|version").await;
    PgWhatsAppStore::open(pool.clone(), account_id, 0, &kms)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE whatsapp_device SET encryption_version = 2 WHERE account_id = $1",
        account_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let error = PgWhatsAppStore::open(pool.clone(), account_id, 0, &kms)
        .await
        .unwrap_err();
    assert!(
        matches!(error, WhatsAppStoreError::UnsupportedVersion(2)),
        "{error:?}"
    );
    assert_eq!(kms.decrypt_calls(), 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn opening_a_missing_account_fails(pool: Pool<Postgres>) {
    let kms = FakeWhatsAppKms::new(KMS_KEY_ID);
    let error = PgWhatsAppStore::open(pool.clone(), Uuid::now_v7(), 0, &kms)
        .await
        .unwrap_err();
    assert!(
        matches!(error, WhatsAppStoreError::AccountNotFound),
        "{error:?}"
    );
    assert_eq!(kms.generate_calls(), 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_takeover_fences_out_the_previous_holder(pool: Pool<Postgres>) {
    let kms = FakeWhatsAppKms::new(KMS_KEY_ID);
    let account_id = insert_account(&pool, "macro|fencing").await;
    let previous = PgWhatsAppStore::open(pool.clone(), account_id, 0, &kms)
        .await
        .unwrap();
    previous
        .put_session("111:0", b"before".to_vec())
        .await
        .unwrap();

    set_lease_epoch(&pool, account_id, 1).await;

    let error = previous
        .put_session("111:0", b"stale".to_vec())
        .await
        .unwrap_err();
    assert!(is_fenced(&error), "{error:?}");
    let error = previous.get_or_gen_pre_keys(5).await.unwrap_err();
    assert!(is_fenced(&error), "{error:?}");
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "count!" FROM whatsapp_pre_key WHERE account_id = $1"#,
            account_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );

    let error = PgWhatsAppStore::open(pool.clone(), account_id, 0, &kms)
        .await
        .unwrap_err();
    assert!(matches!(error, WhatsAppStoreError::Fenced), "{error:?}");

    let next = PgWhatsAppStore::open(pool.clone(), account_id, 1, &kms)
        .await
        .unwrap();
    assert_eq!(
        next.get_session("111:0").await.unwrap(),
        Some(b"before".to_vec())
    );
    next.put_session("111:0", b"after".to_vec()).await.unwrap();
    assert_eq!(
        previous.get_session("111:0").await.unwrap(),
        Some(b"after".to_vec()),
        "reads are not fenced"
    );
}

/// The epoch bump of a takeover waits for an in-flight write of the previous
/// holder, so the write either lands before the takeover or not at all.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_takeover_waits_for_an_in_flight_write(pool: Pool<Postgres>) {
    let kms = FakeWhatsAppKms::new(KMS_KEY_ID);
    let account_id = insert_account(&pool, "macro|in-flight").await;
    let previous = PgWhatsAppStore::open(pool.clone(), account_id, 0, &kms)
        .await
        .unwrap();

    let mut in_flight = previous.begin_write().await.unwrap();
    // While the write is open, the takeover's epoch bump cannot take the row.
    let mut takeover = pool.acquire().await.unwrap();
    sqlx::query!("SET lock_timeout = '200ms'")
        .execute(&mut *takeover)
        .await
        .unwrap();
    let blocked = sqlx::query!(
        "UPDATE whatsapp_linked_account SET lease_epoch = 1 WHERE id = $1",
        account_id,
    )
    .execute(&mut *takeover)
    .await
    .unwrap_err();
    assert!(
        blocked.to_string().contains("lock timeout"),
        "the bump waited on the write: {blocked}"
    );
    previous
        .put_values(
            &mut in_flight,
            crate::cipher::StoreName::Session,
            std::collections::BTreeMap::from([("111:0".to_owned(), b"landed".to_vec())]),
        )
        .await
        .unwrap();
    in_flight.commit().await.unwrap();
    sqlx::query!(
        "UPDATE whatsapp_linked_account SET lease_epoch = 1 WHERE id = $1",
        account_id,
    )
    .execute(&mut *takeover)
    .await
    .unwrap();

    assert_eq!(
        previous.get_session("111:0").await.unwrap(),
        Some(b"landed".to_vec())
    );
    assert!(is_fenced(
        &previous
            .put_session("111:0", b"late".to_vec())
            .await
            .unwrap_err()
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_writers_do_not_lose_writes_or_reuse_prekey_ids(pool: Pool<Postgres>) {
    let kms = FakeWhatsAppKms::new(KMS_KEY_ID);
    let account_id = insert_account(&pool, "macro|concurrent").await;
    let first = Arc::new(
        PgWhatsAppStore::open(pool.clone(), account_id, 0, &kms)
            .await
            .unwrap(),
    );
    let second = Arc::new(
        PgWhatsAppStore::open(pool.clone(), account_id, 0, &kms)
            .await
            .unwrap(),
    );

    let sessions = (0..40u8).map(|index| {
        let store = if index % 2 == 0 {
            first.clone()
        } else {
            second.clone()
        };
        async move { store.put_session(&format!("{index}:0"), vec![index]).await }
    });
    futures::future::try_join_all(sessions).await.unwrap();

    let upload_rounds = |store: &Arc<PgWhatsAppStore>| {
        let store = store.clone();
        async move {
            for _ in 0..5 {
                let keys = store.get_or_gen_pre_keys(10).await?;
                let last = keys.last().map_or(0, |key| key.key_id);
                store.mark_pre_keys_as_uploaded(last).await?;
            }
            Ok::<_, whatsmeow::store::StoreError>(())
        }
    };
    let (first_rounds, second_rounds) = tokio::join!(upload_rounds(&first), upload_rounds(&second));
    first_rounds.unwrap();
    second_rounds.unwrap();

    let all: Vec<String> = (0..40).map(|index| format!("{index}:0")).collect();
    let stored = first.get_many_sessions(&all).await.unwrap();
    for index in 0..40u8 {
        assert_eq!(stored[&format!("{index}:0")], Some(vec![index]));
    }
    // Numbering was serialized: IDs are 1..=n with no gap or duplicate.
    let ids = sqlx::query_scalar!(
        "SELECT key_id FROM whatsapp_pre_key WHERE account_id = $1 ORDER BY key_id",
        account_id,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(ids.len() >= 50, "every round had keys to upload");
    assert_eq!(ids, (1..=ids.len() as i64).collect::<Vec<_>>());
    assert_eq!(first.uploaded_pre_key_count().await.unwrap(), ids.len());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sealed_blobs_open_only_for_their_account_and_purpose(pool: Pool<Postgres>) {
    let kms = FakeWhatsAppKms::new(KMS_KEY_ID);
    let alice_account = insert_account(&pool, "macro|alice").await;
    let bob_account = insert_account(&pool, "macro|bob").await;
    let alice = PgWhatsAppStore::open(pool.clone(), alice_account, 0, &kms)
        .await
        .unwrap();
    let bob = PgWhatsAppStore::open(pool.clone(), bob_account, 0, &kms)
        .await
        .unwrap();

    let sealed = alice.seal("media-locator", b"https://mmg/locator").unwrap();
    assert_eq!(sealed[0], 1);
    assert_eq!(sealed.len(), 1 + 12 + 19 + 16);
    assert_eq!(
        *alice.unseal("media-locator", &sealed).unwrap(),
        b"https://mmg/locator".to_vec()
    );
    assert_ne!(
        alice.seal("media-locator", b"https://mmg/locator").unwrap(),
        sealed
    );

    assert!(matches!(
        alice.unseal("other-purpose", &sealed),
        Err(WhatsAppStoreError::Decrypt)
    ));
    assert!(matches!(
        bob.unseal("media-locator", &sealed),
        Err(WhatsAppStoreError::Decrypt)
    ));
    for tampered_at in [0, 5, sealed.len() - 1] {
        let mut tampered = sealed.clone();
        tampered[tampered_at] ^= 1;
        assert!(alice.unseal("media-locator", &tampered).is_err());
    }
    assert!(alice.unseal("media-locator", &sealed[..10]).is_err());
    assert!(alice.unseal("media-locator", &[]).is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sealed_blob_is_not_a_store_value(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    // A blob sealed for purpose "111:0" can't be planted as the session "111:0".
    let sealed = store.seal("111:0", b"planted").unwrap();
    sqlx::query!(
        r#"
        INSERT INTO whatsapp_store_value (account_id, store, key, nonce, value)
        VALUES ($1, 'session', '111:0', $2, $3)
        "#,
        store.account_id(),
        &sealed[1..13],
        &sealed[13..],
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(store.get_session("111:0").await.is_err());
}
