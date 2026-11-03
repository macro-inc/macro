use std::collections::HashMap;

use chrono::{TimeZone, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use whatsmeow::store::{
    ChatSettingsStore, ContactEntry, ContactStore, MUTED_FOREVER, RedactedPhoneEntry,
};
use whatsmeow::types::{
    ContactInfo, DEFAULT_USER_SERVER, GROUP_SERVER, HIDDEN_USER_SERVER, LocalChatSettings, new_jid,
};

use crate::store::test::open_new_store;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn names_report_whether_they_changed(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let alice = new_jid("111", DEFAULT_USER_SERVER);
    assert_eq!(store.get_contact(&alice).await.unwrap(), None);

    assert_eq!(
        store.put_push_name(&alice, "Alice").await.unwrap(),
        (true, String::new())
    );
    assert_eq!(
        store.put_push_name(&alice, "Alice").await.unwrap(),
        (false, String::new())
    );
    assert_eq!(
        store.put_push_name(&alice, "Al").await.unwrap(),
        (true, "Alice".to_owned())
    );
    assert_eq!(
        store.put_business_name(&alice, "Alice Inc").await.unwrap(),
        (true, String::new())
    );
    store
        .put_contact_name(&alice, "Alice Smith", "Alice")
        .await
        .unwrap();

    assert_eq!(
        store.get_contact(&alice).await.unwrap(),
        Some(ContactInfo {
            first_name: "Alice".to_owned(),
            full_name: "Alice Smith".to_owned(),
            push_name: "Al".to_owned(),
            business_name: "Alice Inc".to_owned(),
            redacted_phone: String::new(),
        })
    );

    // An unchanged empty name for an unknown contact stores nothing.
    let unknown = new_jid("999", DEFAULT_USER_SERVER);
    assert_eq!(
        store.put_push_name(&unknown, "").await.unwrap(),
        (false, String::new())
    );
    assert_eq!(store.get_contact(&unknown).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn batches_merge_into_existing_contacts(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let alice = new_jid("111", DEFAULT_USER_SERVER);
    let bob = new_jid("222", DEFAULT_USER_SERVER);
    let lid_user = new_jid("98765", HIDDEN_USER_SERVER);
    store.put_push_name(&alice, "Al").await.unwrap();

    store
        .put_all_contact_names(&[
            ContactEntry {
                jid: alice.clone(),
                first_name: "Wrong".to_owned(),
                full_name: "Wrong".to_owned(),
            },
            ContactEntry {
                jid: bob.clone(),
                first_name: "Bob".to_owned(),
                full_name: "Bob Jones".to_owned(),
            },
            // Listed twice: the last entry wins.
            ContactEntry {
                jid: alice.clone(),
                first_name: "Alice".to_owned(),
                full_name: "Alice Smith".to_owned(),
            },
        ])
        .await
        .unwrap();
    store
        .put_many_redacted_phones(&[RedactedPhoneEntry {
            jid: lid_user.clone(),
            redacted_phone: "+1∙∙∙∙∙∙∙∙80".to_owned(),
        }])
        .await
        .unwrap();
    store.put_all_contact_names(&[]).await.unwrap();

    assert_eq!(
        store.get_all_contacts().await.unwrap(),
        HashMap::from([
            (
                alice,
                ContactInfo {
                    first_name: "Alice".to_owned(),
                    full_name: "Alice Smith".to_owned(),
                    push_name: "Al".to_owned(),
                    ..ContactInfo::default()
                }
            ),
            (
                bob,
                ContactInfo {
                    first_name: "Bob".to_owned(),
                    full_name: "Bob Jones".to_owned(),
                    ..ContactInfo::default()
                }
            ),
            (
                lid_user,
                ContactInfo {
                    redacted_phone: "+1∙∙∙∙∙∙∙∙80".to_owned(),
                    ..ContactInfo::default()
                }
            ),
        ])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn chat_settings_are_kept_per_chat(pool: Pool<Postgres>) {
    let store = open_new_store(&pool).await;
    let group = new_jid("123-456", GROUP_SERVER);
    let direct = new_jid("111", DEFAULT_USER_SERVER);
    assert_eq!(store.get_chat_settings(&group).await.unwrap(), None);

    let muted_until = Utc.with_ymd_and_hms(2030, 1, 2, 3, 4, 5).unwrap();
    store
        .put_muted_until(&group, Some(muted_until))
        .await
        .unwrap();
    store.put_pinned(&group, true).await.unwrap();
    store.put_archived(&direct, true).await.unwrap();
    store
        .put_muted_until(&direct, Some(*MUTED_FOREVER))
        .await
        .unwrap();

    assert_eq!(
        store.get_chat_settings(&group).await.unwrap(),
        Some(LocalChatSettings {
            muted_until: Some(muted_until),
            pinned: true,
            archived: false,
        })
    );
    assert_eq!(
        store.get_chat_settings(&direct).await.unwrap(),
        Some(LocalChatSettings {
            muted_until: Some(*MUTED_FOREVER),
            pinned: false,
            archived: true,
        })
    );

    store.put_muted_until(&group, None).await.unwrap();
    assert_eq!(
        store.get_chat_settings(&group).await.unwrap(),
        Some(LocalChatSettings {
            muted_until: None,
            pinned: true,
            archived: false,
        })
    );

    // Storing only the WASA root secret ID creates the chat's settings.
    let other = new_jid("789-012", GROUP_SERVER);
    assert_eq!(store.get_wasa_root_secret_id(&other).await.unwrap(), None);
    store
        .put_wasa_root_secret_id(&other, &"3EB0ABCDEF".to_owned())
        .await
        .unwrap();
    assert_eq!(
        store.get_wasa_root_secret_id(&other).await.unwrap(),
        Some("3EB0ABCDEF".to_owned())
    );
    assert_eq!(
        store.get_chat_settings(&other).await.unwrap(),
        Some(LocalChatSettings::default())
    );
}
