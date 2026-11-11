use chrono::{TimeZone, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use whatsmeow::store::{
    EventBuffer, LidStore, MessageSecretInsert, MsgSecretStore, NctSaltStore, PrivacyToken,
    PrivacyTokenStore,
};
use whatsmeow::types::{
    DEFAULT_USER_SERVER, GROUP_SERVER, HIDDEN_USER_SERVER, new_ad_jid, new_jid,
};

use crate::store::test::open_new_store;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn message_secrets_keep_the_first_and_are_found_by_either_identity(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let group = new_jid("123-456", GROUP_SERVER);
    let sender_pn = new_jid("111", DEFAULT_USER_SERVER);
    let sender_lid = new_jid("98765", HIDDEN_USER_SERVER);
    let sender_device = new_ad_jid("111", 0, 3);

    store
        .put_message_secrets(&[
            MessageSecretInsert {
                chat: group.clone(),
                sender: sender_device.clone(),
                id: "A1".to_owned(),
                secret: vec![1],
            },
            MessageSecretInsert {
                chat: group.clone(),
                sender: sender_pn.clone(),
                id: "A1".to_owned(),
                secret: vec![2],
            },
            // Skipped: no secret.
            MessageSecretInsert {
                chat: group.clone(),
                sender: sender_pn.clone(),
                id: "A2".to_owned(),
                secret: vec![],
            },
        ])
        .await
        .unwrap();
    store
        .put_message_secret(&group, &sender_pn, &"A1".to_owned(), vec![3])
        .await
        .unwrap();

    assert_eq!(
        store
            .get_message_secret(&group, &sender_device, &"A1".to_owned())
            .await
            .unwrap(),
        Some((vec![1], sender_pn.clone()))
    );
    assert_eq!(
        store
            .get_message_secret(&group, &sender_pn, &"A2".to_owned())
            .await
            .unwrap(),
        None
    );
    // Not found by the LID until the mapping is known.
    assert_eq!(
        store
            .get_message_secret(&group, &sender_lid, &"A1".to_owned())
            .await
            .unwrap(),
        None
    );
    store
        .put_lid_mapping(&sender_lid, &sender_pn)
        .await
        .unwrap();
    assert_eq!(
        store
            .get_message_secret(&group, &sender_lid, &"A1".to_owned())
            .await
            .unwrap(),
        Some((vec![1], sender_pn))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn privacy_tokens_only_move_forward_in_time(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let alice = new_jid("111", DEFAULT_USER_SERVER);
    let alice_lid = new_jid("98765", HIDDEN_USER_SERVER);
    let bob = new_jid("222", DEFAULT_USER_SERVER);
    let at = |seconds: i64| Utc.timestamp_opt(1_700_000_000 + seconds, 0).unwrap();
    assert_eq!(store.get_privacy_token(&alice).await.unwrap(), None);

    store
        .put_privacy_tokens(&[
            PrivacyToken {
                user: new_ad_jid("111", 0, 2),
                token: vec![1],
                timestamp: at(10),
                sender_timestamp: Some(at(5)),
            },
            PrivacyToken {
                user: bob.clone(),
                token: vec![2],
                timestamp: at(10),
                sender_timestamp: None,
            },
        ])
        .await
        .unwrap();
    // Older: ignored.
    store
        .put_privacy_tokens(&[PrivacyToken {
            user: alice.clone(),
            token: vec![9],
            timestamp: at(1),
            sender_timestamp: None,
        }])
        .await
        .unwrap();
    assert_eq!(
        store.get_privacy_token(&alice).await.unwrap(),
        Some(PrivacyToken {
            user: alice.clone(),
            token: vec![1],
            timestamp: at(10),
            sender_timestamp: Some(at(5)),
        })
    );
    // Newer without a sender timestamp: keeps the stored sender timestamp.
    store
        .put_privacy_tokens(&[PrivacyToken {
            user: alice.clone(),
            token: vec![3],
            timestamp: at(20),
            sender_timestamp: None,
        }])
        .await
        .unwrap();
    let expected = PrivacyToken {
        user: alice.clone(),
        token: vec![3],
        timestamp: at(20),
        sender_timestamp: Some(at(5)),
    };
    assert_eq!(
        store.get_privacy_token(&alice).await.unwrap(),
        Some(expected.clone())
    );

    // Found by the LID once mapped, reported under the asked-for user.
    store.put_lid_mapping(&alice_lid, &alice).await.unwrap();
    assert_eq!(
        store.get_privacy_token(&alice_lid).await.unwrap(),
        Some(PrivacyToken {
            user: alice_lid,
            ..expected
        })
    );

    assert_eq!(
        store.delete_expired_privacy_tokens(at(15)).await.unwrap(),
        1
    );
    assert_eq!(store.get_privacy_token(&bob).await.unwrap(), None);
    assert!(store.get_privacy_token(&alice).await.unwrap().is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_nct_salt_round_trips(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    assert_eq!(store.get_nct_salt().await.unwrap(), None);
    store.put_nct_salt(vec![1, 2, 3]).await.unwrap();
    store.put_nct_salt(vec![4, 5]).await.unwrap();
    assert_eq!(store.get_nct_salt().await.unwrap(), Some(vec![4, 5]));
    store.delete_nct_salt().await.unwrap();
    assert_eq!(store.get_nct_salt().await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn buffered_events_are_cleared_and_expire(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let server_time = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
    assert_eq!(store.get_buffered_event([1; 32]).await.unwrap(), None);

    store
        .put_buffered_event([1; 32], b"decrypted".to_vec(), server_time)
        .await
        .unwrap();
    store
        .put_buffered_event([2; 32], b"other".to_vec(), server_time)
        .await
        .unwrap();
    let buffered = store.get_buffered_event([1; 32]).await.unwrap().unwrap();
    assert_eq!(buffered.plaintext, b"decrypted".to_vec());
    assert_eq!(buffered.server_time, server_time);

    store.clear_buffered_event_plaintext([1; 32]).await.unwrap();
    let cleared = store.get_buffered_event([1; 32]).await.unwrap().unwrap();
    assert_eq!(cleared.plaintext, Vec::<u8>::new());
    assert_eq!(cleared.insert_time, buffered.insert_time);

    let ran = std::sync::atomic::AtomicBool::new(false);
    store
        .do_decryption_txn(Box::pin(async {
            ran.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        }))
        .await
        .unwrap();
    assert!(ran.into_inner());

    sqlx::query!(
        r#"
        UPDATE whatsapp_event_buffer
        SET inserted_at = now() - interval '15 days'
        WHERE account_id = $1 AND ciphertext_hash = $2
        "#,
        store.account_id(),
        [2u8; 32].as_slice(),
    )
    .execute(&pool)
    .await
    .unwrap();
    store.delete_old_buffered_hashes().await.unwrap();
    assert_eq!(store.get_buffered_event([2; 32]).await.unwrap(), None);
    assert!(store.get_buffered_event([1; 32]).await.unwrap().is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn outgoing_events_are_found_by_either_chat_and_expire(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let chat = new_jid("111", DEFAULT_USER_SERVER);
    let alt_chat = new_jid("98765", HIDDEN_USER_SERVER);
    let other = new_jid("222", DEFAULT_USER_SERVER);
    let id = "3EB0AA".to_owned();

    store
        .add_outgoing_event(&alt_chat, &id, "e2e", b"sent".to_vec())
        .await
        .unwrap();
    assert_eq!(
        store
            .get_outgoing_event(&chat, &alt_chat, &id)
            .await
            .unwrap(),
        Some(("e2e".to_owned(), b"sent".to_vec()))
    );
    store
        .add_outgoing_event(&chat, &id, "fb", b"sent to pn".to_vec())
        .await
        .unwrap();
    assert_eq!(
        store
            .get_outgoing_event(&chat, &alt_chat, &id)
            .await
            .unwrap(),
        Some(("fb".to_owned(), b"sent to pn".to_vec()))
    );
    assert_eq!(
        store.get_outgoing_event(&other, &other, &id).await.unwrap(),
        None
    );

    sqlx::query!(
        r#"
        UPDATE whatsapp_outgoing_event
        SET created_at = now() - interval '8 days'
        WHERE account_id = $1 AND chat_jid = '111@s.whatsapp.net'
        "#,
        store.account_id(),
    )
    .execute(&pool)
    .await
    .unwrap();
    store.delete_old_outgoing_events().await.unwrap();
    assert_eq!(
        store
            .get_outgoing_event(&chat, &alt_chat, &id)
            .await
            .unwrap(),
        Some(("e2e".to_owned(), b"sent".to_vec()))
    );
}
