use email_api_client::domain::models::EmailApiError;
use email_api_client::domain::ports::{
    MailboxBlocklistClient, MailboxLabelClient, MailboxMessageClient, MailboxSyncClient,
};
use models_email::gmail::labels::GmailLabel;
use uuid::Uuid;

use super::*;
use crate::{NewAttachment, SeedLabel, SeedSendAs};

#[tokio::test]
async fn a_seeded_mailbox_reads_back_through_the_real_client() {
    let first = NewMessage {
        message_id: Some("first@example.com".to_string()),
        ..mail(
            "Grace <grace@example.com>",
            "Quarterly numbers",
            "Numbers attached.",
        )
    };
    let reply = NewMessage {
        in_reply_to: Some("first@example.com".to_string()),
        html: Some("<p>Thanks, <b>got them</b>.</p>".to_string()),
        attachments: vec![NewAttachment {
            filename: "numbers.CSV".to_string(),
            mime_type: Some("text/csv".to_string()),
            text: Some("q,total\n1,42\n".to_string()),
            base64: None,
        }],
        labels: Some(vec!["INBOX".to_string(), "STARRED".to_string()]),
        ..mail(
            "Grace <grace@example.com>",
            "Re: Quarterly numbers",
            "Thanks, got them.",
        )
    };
    let emulator = GmailEmulator::start(Seed {
        mailboxes: vec![mailbox_with(ADA, vec![first, reply])],
        ..Seed::default()
    })
    .await
    .unwrap();
    let repository = repository(&emulator);
    let access = token(&emulator, ADA);
    let link_id = Uuid::now_v7();

    assert_eq!(repository.get_thread_count(&access).await.unwrap(), 1);
    let threads = repository
        .list_threads(&access, 10, None, &[])
        .await
        .unwrap();
    assert_eq!(threads.threads.len(), 1);
    let messages = repository
        .get_thread(&access, link_id, &threads.threads[0].provider_id)
        .await
        .unwrap();
    assert_eq!(messages.len(), 2);

    let first = &messages[0].message;
    assert_eq!(first.subject.as_deref(), Some("Quarterly numbers"));
    assert_eq!(
        first.body_text.as_deref().map(str::trim),
        Some("Numbers attached.")
    );
    assert_eq!(first.from.as_ref().unwrap().email, "grace@example.com");
    assert_eq!(first.from.as_ref().unwrap().name.as_deref(), Some("Grace"));
    assert!(!first.is_read);

    let reply = &messages[1].message;
    assert!(reply.is_read && reply.is_starred);
    assert!(
        reply
            .body_html_sanitized
            .as_deref()
            .unwrap()
            .contains("got them")
    );
    assert_eq!(reply.attachments.len(), 1);
    assert_eq!(
        reply.attachments[0].filename.as_deref(),
        Some("numbers.csv")
    );

    let client = client(&emulator);
    let attachment = client
        .get_attachment_data(
            access.expose_secret(),
            reply.provider_id.as_deref().unwrap(),
            reply.attachments[0].provider_id.as_deref().unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(attachment, b"q,total\n1,42\n");

    let raw = client
        .get_raw_message(
            access.expose_secret(),
            first.provider_id.as_deref().unwrap(),
        )
        .await
        .unwrap()
        .unwrap();
    assert!(
        String::from_utf8(raw)
            .unwrap()
            .contains("Message-ID: <first@example.com>")
    );

    let starred = client
        .list_messages(access.expose_secret(), 10, &["STARRED"])
        .await
        .unwrap();
    assert_eq!(starred, vec![reply.provider_id.clone().unwrap()]);
    assert!(
        client
            .get_message(access.expose_secret(), "missing")
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn a_sent_message_is_stored_as_sent_and_arrives_in_the_recipients_mailbox() {
    let emulator = two_mailboxes().await;
    let client = client(&emulator);
    let ada = emulator.access_token(ADA).unwrap();
    let bob = emulator.access_token(BOB).unwrap();
    let mime = b"From: ada@example.com\r\nTo: Bob <bob@example.com>\r\nBcc: carol@example.com\r\n\
        Subject: Lunch\r\nMessage-ID: <lunch-1@macro.test>\r\n\r\nNoon?\r\n";

    let sent = client.send_message(&ada, mime, None).await.unwrap();

    let found = client
        .find_sent_message(&ada, "lunch-1@macro.test")
        .await
        .unwrap();
    assert_eq!(found.unwrap().id, sent.id);
    assert_eq!(
        client
            .get_message_label_ids(&ada, &sent.id)
            .await
            .unwrap()
            .unwrap(),
        vec!["SENT".to_string()]
    );

    let inbox = client
        .list_messages(&bob, 10, &["INBOX", "UNREAD"])
        .await
        .unwrap();
    assert_eq!(inbox.len(), 1);
    let arrived = client.get_message(&bob, &inbox[0]).await.unwrap().unwrap();
    assert_eq!(arrived.snippet, "Noon?");
    assert!(
        arrived
            .payload
            .headers
            .iter()
            .all(|header| header.name != "Bcc")
    );

    // A reply in the same thread, then one in a thread Gmail does not have.
    let reply =
        b"From: ada@example.com\r\nTo: bob@example.com\r\nSubject: Re: Lunch\r\n\r\nOr one?\r\n";
    let threaded = client
        .send_message(&ada, reply, Some(&sent.thread_id))
        .await
        .unwrap();
    assert_eq!(threaded.thread_id, sent.thread_id);
    assert_eq!(
        client
            .get_message_ids_for_thread(&ada, &sent.thread_id)
            .await
            .unwrap(),
        vec![sent.id.clone(), threaded.id]
    );
    let missing = client
        .send_message(&ada, reply, Some("no-such-thread"))
        .await
        .unwrap_err();
    assert_eq!(missing.status().unwrap().as_u16(), 404);
}

#[tokio::test]
async fn labels_can_be_created_applied_and_deleted() {
    let emulator = GmailEmulator::start(Seed {
        mailboxes: vec![SeedMailbox {
            labels: vec![SeedLabel {
                id: None,
                name: "Receipts".to_string(),
            }],
            send_as: vec![SeedSendAs {
                email: "ada@alias.example.com".to_string(),
                name: Some("Ada Alias".to_string()),
                signature: Some("<i>Ada</i>".to_string()),
                verified: false,
            }],
            ..mailbox_with(
                ADA,
                vec![
                    mail("grace@example.com", "One", "1"),
                    mail("grace@example.com", "Two", "2"),
                ],
            )
        }],
        ..Seed::default()
    })
    .await
    .unwrap();
    let client = client(&emulator);
    let ada = emulator.access_token(ADA).unwrap();
    let ids = client.list_messages(&ada, 10, &[]).await.unwrap();
    let label = |name: &str| GmailLabel {
        id: None,
        name: name.to_string(),
        message_list_visibility: None,
        label_list_visibility: None,
        type_: None,
        color: None,
    };

    let created = client.create_label(&ada, &label("Travel")).await.unwrap();
    let travel = created.id.unwrap();
    let duplicate = client
        .create_label(&ada, &label("receipts"))
        .await
        .unwrap_err();
    assert_eq!(duplicate.status().unwrap().as_u16(), 409);

    client
        .batch_modify_message_labels(
            &ada,
            &[ids[0].clone(), "unknown-message".to_string()],
            std::slice::from_ref(&travel),
            &["UNREAD".to_string()],
        )
        .await
        .unwrap();
    assert_eq!(
        client
            .get_message_label_ids(&ada, &ids[0])
            .await
            .unwrap()
            .unwrap(),
        vec!["INBOX".to_string(), travel.clone()]
    );
    let invalid = client
        .modify_message_labels(&ada, &ids[1], &["Label_404".to_string()], &[])
        .await
        .unwrap_err();
    assert_eq!(invalid.status().unwrap().as_u16(), 400);
    let immutable = client
        .modify_message_labels(&ada, &ids[1], &["SENT".to_string()], &[])
        .await
        .unwrap_err();
    assert_eq!(immutable.status().unwrap().as_u16(), 400);

    client.delete_label(&ada, &travel).await.unwrap();
    assert_eq!(
        client
            .get_message_label_ids(&ada, &ids[0])
            .await
            .unwrap()
            .unwrap(),
        vec!["INBOX".to_string()]
    );
    let names: Vec<String> = repository(&emulator)
        .list_labels(&AccessToken::new(ada.clone()), Uuid::now_v7())
        .await
        .unwrap()
        .into_iter()
        .filter_map(|label| label.name)
        .collect();
    assert!(names.contains(&"Receipts".to_string()) && !names.contains(&"Travel".to_string()));

    let aliases = client.list_send_as(&ada).await.unwrap().send_as.unwrap();
    assert_eq!(aliases.len(), 2);
    assert_eq!(aliases[0].is_primary, Some(true));
    assert_eq!(aliases[1].send_as_email, "ada@alias.example.com");
    assert_eq!(
        aliases[1].verification_status,
        Some(models_email::gmail::SendAsVerificationStatus::Pending)
    );
}

#[tokio::test]
async fn a_blocked_senders_mail_goes_to_trash() {
    let emulator = two_mailboxes().await;
    let repository = repository(&emulator);
    let ada = token(&emulator, ADA);

    repository
        .block_sender(&ada, "spam@example.com")
        .await
        .unwrap();
    repository
        .block_sender(&ada, "spam@example.com")
        .await
        .unwrap();
    assert_eq!(
        repository.list_blocked_senders(&ada).await.unwrap(),
        vec!["spam@example.com".to_string()]
    );

    let blocked = emulator
        .deliver(ADA, &mail("spam@example.com", "Win", "Now"))
        .unwrap();
    let wanted = emulator
        .deliver(ADA, &mail("grace@example.com", "Hi", "There"))
        .unwrap();
    let client = client(&emulator);
    let labels = |id: String| {
        let (client, ada) = (client.clone(), ada.expose_secret().to_string());
        async move {
            client
                .get_message_label_ids(&ada, &id)
                .await
                .unwrap()
                .unwrap()
        }
    };
    assert!(labels(blocked.id).await.contains(&"TRASH".to_string()));
    assert!(!labels(wanted.id).await.contains(&"TRASH".to_string()));

    repository
        .unblock_sender(&ada, "spam@example.com")
        .await
        .unwrap();
    assert!(
        repository
            .list_blocked_senders(&ada)
            .await
            .unwrap()
            .is_empty()
    );
    let missing = repository.unblock_sender(&ada, "spam@example.com").await;
    assert!(matches!(missing, Ok(()) | Err(EmailApiError::NotFound)));
}

#[tokio::test]
async fn saving_a_draft_replaces_its_message_and_sending_it_keeps_the_thread() {
    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;

    let emulator = two_mailboxes().await;
    let ada = emulator.access_token(ADA).unwrap();
    let http = reqwest::Client::new();
    let drafts = format!("{}/users/me/drafts", emulator.gmail_url());
    let body = |text: &str| {
        let mime = format!("To: bob@example.com\r\nSubject: Draft\r\n\r\n{text}\r\n");
        serde_json::json!({ "message": { "raw": URL_SAFE_NO_PAD.encode(mime) } })
    };

    let created: serde_json::Value = http
        .post(&drafts)
        .bearer_auth(&ada)
        .json(&body("first"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let draft_id = created["id"].as_str().unwrap();
    let saved: serde_json::Value = http
        .put(format!("{drafts}/{draft_id}"))
        .bearer_auth(&ada)
        .json(&body("second"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_ne!(saved["message"]["id"], created["message"]["id"]);
    assert_eq!(saved["message"]["threadId"], created["message"]["threadId"]);
    let stored = emulator.messages(ADA).unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].labels, vec!["DRAFT".to_string()]);

    let sent: serde_json::Value = http
        .post(format!("{drafts}/send"))
        .bearer_auth(&ada)
        .json(&serde_json::json!({ "id": draft_id }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(sent["threadId"], created["message"]["threadId"]);
    assert_eq!(
        emulator.messages(ADA).unwrap()[0].labels,
        vec!["SENT".to_string()]
    );
    assert_eq!(emulator.messages(BOB).unwrap()[0].snippet, "second");
}
