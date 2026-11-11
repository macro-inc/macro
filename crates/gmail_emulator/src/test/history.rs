use std::time::Duration;

use email_api_client::domain::models::{EmailApiError, SyncCursor};
use email_api_client::domain::ports::MailboxSyncClient;

use super::*;

#[tokio::test]
async fn changes_after_a_cursor_show_up_in_history() {
    let emulator = two_mailboxes().await;
    let repository = repository(&emulator);
    let client = client(&emulator);
    let ada = token(&emulator, ADA);
    let cursor = client
        .get_profile(ada.expose_secret())
        .await
        .unwrap()
        .history_id;

    let kept = emulator
        .deliver(ADA, &mail("grace@example.com", "Kept", "k"))
        .unwrap();
    let relabelled = emulator
        .deliver(ADA, &mail("grace@example.com", "Read", "r"))
        .unwrap();
    let deleted = emulator
        .deliver(ADA, &mail("grace@example.com", "Gone", "g"))
        .unwrap();
    let before_labels = client
        .get_profile(ada.expose_secret())
        .await
        .unwrap()
        .history_id;
    client
        .modify_message_labels(
            ada.expose_secret(),
            &relabelled.id,
            &[],
            &["UNREAD".to_string()],
        )
        .await
        .unwrap();
    emulator.delete_message(ADA, &deleted.id).unwrap();

    let page = repository
        .list_changes_page(&ada, &SyncCursor::gmail(cursor), None)
        .await
        .unwrap();
    assert_eq!(
        page.changes.message_ids_to_upsert,
        [kept.id, relabelled.id.clone()].into_iter().collect()
    );
    assert_eq!(
        page.changes.message_ids_to_delete,
        [deleted.id.clone()].into_iter().collect()
    );
    let current = client
        .get_profile(ada.expose_secret())
        .await
        .unwrap()
        .history_id;
    assert_eq!(page.cursor, Some(SyncCursor::gmail(current.clone())));

    // From after the deliveries, only the label change and the deletion remain.
    let later = repository
        .list_changes_page(&ada, &SyncCursor::gmail(before_labels), None)
        .await
        .unwrap();
    assert!(later.changes.message_ids_to_upsert.is_empty());
    assert_eq!(
        later.changes.labels_to_update,
        [relabelled.id].into_iter().collect()
    );
    assert_eq!(
        later.changes.message_ids_to_delete,
        [deleted.id].into_iter().collect()
    );

    let nothing = repository
        .list_changes_page(&ada, &SyncCursor::gmail(current), None)
        .await
        .unwrap();
    assert_eq!(nothing.changes, Default::default());

    // Another mailbox's history is its own.
    let bob = token(&emulator, BOB);
    let bob_cursor = client
        .get_profile(bob.expose_secret())
        .await
        .unwrap()
        .history_id;
    let bob_page = repository
        .list_changes_page(&bob, &SyncCursor::gmail(bob_cursor), None)
        .await
        .unwrap();
    assert_eq!(bob_page.changes, Default::default());
}

#[tokio::test]
async fn history_is_paged() {
    let emulator = two_mailboxes().await;
    let ada = emulator.access_token(ADA).unwrap();
    for number in 0..5 {
        emulator
            .deliver(
                ADA,
                &mail("grace@example.com", &format!("Mail {number}"), "body"),
            )
            .unwrap();
    }
    let http = reqwest::Client::new();
    let history = format!("{}/users/me/history", emulator.gmail_url());

    let first: serde_json::Value = http
        .get(&history)
        .bearer_auth(&ada)
        .query(&[("startHistoryId", "1000"), ("maxResults", "2")])
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(first["history"].as_array().unwrap().len(), 2);
    assert_eq!(first["nextPageToken"], "2");

    let last: serde_json::Value = http
        .get(&history)
        .bearer_auth(&ada)
        .query(&[
            ("startHistoryId", "1000"),
            ("maxResults", "2"),
            ("pageToken", "4"),
        ])
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(last["history"].as_array().unwrap().len(), 1);
    assert!(last.get("nextPageToken").is_none());
    assert_eq!(last["historyId"], "1005");
}

#[tokio::test]
async fn a_history_id_older_than_gmail_keeps_is_an_outdated_cursor() {
    let emulator = two_mailboxes().await;
    let repository = repository(&emulator);
    let ada = token(&emulator, ADA);
    let stored = SyncCursor::gmail("1000");
    emulator
        .deliver(ADA, &mail("grace@example.com", "Old", "o"))
        .unwrap();
    assert!(
        repository
            .list_changes_page(&ada, &stored, None)
            .await
            .is_ok()
    );

    // Eight days later Gmail has forgotten the change the cursor precedes.
    emulator.advance_clock(Duration::from_secs(8 * 24 * 60 * 60));
    let ada = token(&emulator, ADA);
    let expired = repository.list_changes_page(&ada, &stored, None).await;
    assert_eq!(expired.unwrap_err(), EmailApiError::OutdatedCursor);

    // The current id still works, and so does the one after a forced expiry.
    let current = client(&emulator)
        .get_profile(ada.expose_secret())
        .await
        .unwrap()
        .history_id;
    let cursor = SyncCursor::gmail(current);
    assert!(
        repository
            .list_changes_page(&ada, &cursor, None)
            .await
            .is_ok()
    );
    emulator.expire_history(ADA).unwrap();
    let forced = repository.list_changes_page(&ada, &cursor, None).await;
    assert_eq!(forced.unwrap_err(), EmailApiError::OutdatedCursor);
}
