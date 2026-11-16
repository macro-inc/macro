use email_api_client::domain::models::{EmailApiError, FolderRole, MessageAction};
use email_api_client::domain::ports::{
    MailboxActionWriter, MailboxAddressBookReader, MailboxContentReader, MailboxLabelClient,
    MailboxSettingsClient,
};
use uuid::Uuid;

use super::{ADA, id, message_id, start, token};
use crate::{NewMessage, SeedContact};

const ONE_MESSAGE: &str = "mailboxes:\n  - email: ada@example.com\n    name: Ada Example\n    messages:\n      - subject: Hello\n        from: Grace <grace@example.com>\n";

#[tokio::test]
async fn message_actions_change_what_the_mailbox_reads_back() {
    let (emulator, api) = start(ONE_MESSAGE).await;
    let token = token(&emulator, ADA);
    let hello = message_id(&emulator, ADA, "Hello");

    api.apply_message_action(&token, &hello, &MessageAction::SetRead(true), None)
        .await
        .unwrap();
    api.apply_message_action(&token, &hello, &MessageAction::SetFlagged(true), None)
        .await
        .unwrap();

    let stored = &emulator.messages(ADA).unwrap()[0];
    assert!(stored.is_read && stored.flagged);

    let folders = api.folders(&token).await.unwrap();
    let organization = api
        .organization(&token, Uuid::now_v7(), &hello, &folders)
        .await
        .unwrap()
        .unwrap();
    assert!(organization.state.is_read && organization.state.is_flagged);
}

#[tokio::test]
async fn tags_are_written_only_against_the_version_that_was_read() {
    let (emulator, api) = start(ONE_MESSAGE).await;
    let token = token(&emulator, ADA);
    let hello = message_id(&emulator, ADA, "Hello");
    let folders = api.folders(&token).await.unwrap();
    let read = api
        .message(&token, Uuid::now_v7(), &hello, &folders)
        .await
        .unwrap()
        .unwrap();
    let version = read.version.unwrap();

    let tags = MessageAction::SetTags(vec!["Finance".into()]);
    let receipt = api
        .apply_message_action(&token, &hello, &tags, Some(&version))
        .await
        .unwrap();
    assert_ne!(receipt.version.as_deref(), Some(version.as_str()));
    assert_eq!(
        emulator.messages(ADA).unwrap()[0].categories,
        vec!["Finance".to_string()]
    );

    // The version read before the write is stale now.
    let stale = api
        .apply_message_action(&token, &hello, &tags, Some(&version))
        .await
        .unwrap_err();
    assert!(matches!(stale, EmailApiError::Conflict));
}

#[tokio::test]
async fn archiving_moves_to_archive_or_creates_one_when_the_mailbox_has_none() {
    let (emulator, api) = start(ONE_MESSAGE).await;
    let token = token(&emulator, ADA);
    let hello = message_id(&emulator, ADA, "Hello");
    api.apply_message_action(&token, &hello, &MessageAction::Archive, None)
        .await
        .unwrap();
    assert_eq!(emulator.messages(ADA).unwrap()[0].folder, "Archive");

    let seed = "mailboxes:\n  - email: ada@example.com\n    without_archive_folder: true\n    messages:\n      - subject: Hello\n      - subject: Again\n";
    let (emulator, api) = start(seed).await;
    let token = super::token(&emulator, ADA);
    for subject in ["Hello", "Again"] {
        let message = message_id(&emulator, ADA, subject);
        api.apply_message_action(&token, &message, &MessageAction::Archive, None)
            .await
            .unwrap();
    }

    let messages = emulator.messages(ADA).unwrap();
    assert!(messages[0].folder.starts_with("Macro Archive"));
    assert_eq!(messages[0].folder, messages[1].folder);
    let folders = api.folders(&token).await.unwrap();
    let archives = folders.iter().filter(|f| f.role == FolderRole::Archive);
    assert_eq!(archives.count(), 1);
}

#[tokio::test]
async fn moving_to_a_folder_keeps_the_message_id() {
    let (emulator, api) = start(ONE_MESSAGE).await;
    let token = token(&emulator, ADA);
    let hello = message_id(&emulator, ADA, "Hello");
    let folders = api.folders(&token).await.unwrap();
    let junk = folders.iter().find(|f| f.role == FolderRole::Junk).unwrap();

    let receipt = api
        .apply_message_action(
            &token,
            &hello,
            &MessageAction::MoveToFolder(junk.id.clone()),
            None,
        )
        .await
        .unwrap();

    assert_eq!(receipt.id, hello);
    assert_eq!(emulator.messages(ADA).unwrap()[0].folder, "Junk Email");
}

#[tokio::test]
async fn categories_are_created_listed_found_on_messages_and_deleted() {
    let (emulator, api) = start(ONE_MESSAGE).await;
    let token = token(&emulator, ADA);
    let link_id = Uuid::now_v7();

    api.create_label(&token, link_id, "Bob's \"urgent\"")
        .await
        .unwrap();
    api.create_label(&token, link_id, "Finance").await.unwrap();
    let names: Vec<_> = api
        .list_labels(&token, link_id)
        .await
        .unwrap()
        .into_iter()
        .map(|label| label.provider_label_id)
        .collect();
    assert_eq!(
        names,
        vec!["Bob's \"urgent\"".to_string(), "Finance".to_string()]
    );

    let tagged = NewMessage {
        subject: Some("Tagged".into()),
        categories: vec!["Bob's \"urgent\"".into()],
        ..NewMessage::default()
    };
    let delivered = emulator.deliver(ADA, &tagged).unwrap();
    let found = api
        .category_messages(&token, "Bob's \"urgent\"")
        .await
        .unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].id, id(&delivered.id));
    assert!(found[0].version.is_some());

    api.delete_label(&token, "Finance").await.unwrap();
    assert_eq!(api.list_labels(&token, link_id).await.unwrap().len(), 1);
}

#[tokio::test]
async fn a_sender_rule_sends_that_senders_new_mail_to_deleted_items() {
    let (emulator, api) = start(ONE_MESSAGE).await;
    let token = token(&emulator, ADA);
    let correlation = Uuid::now_v7();

    let rule = api
        .create_sender_rule(&token, correlation, "spam@example.com")
        .await
        .unwrap();
    let rules = api.sender_rules(&token).await.unwrap();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].correlation, correlation);
    assert_eq!(rules[0].sender, "spam@example.com");

    let blocked = NewMessage {
        from: Some("Spammer <spam@example.com>".into()),
        subject: Some("Buy now".into()),
        ..NewMessage::default()
    };
    emulator.deliver(ADA, &blocked).unwrap();
    let folder_of = |subject: &str| {
        let messages = emulator.messages(ADA).unwrap();
        messages
            .iter()
            .find(|m| m.subject == subject)
            .unwrap()
            .folder
            .clone()
    };
    assert_eq!(folder_of("Buy now"), "Deleted Items");

    api.remove_sender_rule(&token, &rule).await.unwrap();
    let allowed = NewMessage {
        subject: Some("Buy later".into()),
        ..blocked
    };
    emulator.deliver(ADA, &allowed).unwrap();
    assert_eq!(folder_of("Buy later"), "Inbox");
}

#[tokio::test]
async fn contacts_sync_from_the_default_folder_and_report_removals() {
    let seed = "mailboxes:\n  - email: ada@example.com\n    name: Ada Example\n    contacts:\n      - { email: Grace@Example.com, name: Grace Example }\n      - { email: alan@example.com }\n";
    let (emulator, api) = start(seed).await;
    let token = token(&emulator, ADA);

    let me = api.self_contact(&token).await.unwrap();
    assert_eq!(me.emails, vec![ADA.to_string()]);
    assert_eq!(me.name.as_deref(), Some("Ada Example"));
    assert!(api.contact_photo(&token, None).await.unwrap().is_none());

    let catalog = api.contact_folders(&token).await.unwrap();
    let folder = catalog.default_folder.unwrap();
    let first = api.contact_changes(&token, &folder, None).await.unwrap();
    let mut emails: Vec<_> = first
        .contacts
        .iter()
        .flat_map(|c| c.emails.clone())
        .collect();
    emails.sort();
    assert_eq!(
        emails,
        vec![
            "alan@example.com".to_string(),
            "grace@example.com".to_string()
        ]
    );
    let email_api_client::domain::models::StreamPosition::Checkpoint(checkpoint) = first.position
    else {
        panic!("contacts delta ends with a checkpoint");
    };

    let grace = first.contacts.iter().find(|c| c.name.is_some()).unwrap();
    emulator.remove_contact(ADA, grace.id.as_str()).unwrap();
    let carol = SeedContact {
        email: "carol@example.com".into(),
        name: Some("Carol".into()),
    };
    emulator.upsert_contact(ADA, None, &carol).unwrap();

    let second = api
        .contact_changes(&token, &folder, Some(&checkpoint))
        .await
        .unwrap();
    assert_eq!(second.contacts.len(), 1);
    assert_eq!(
        second.contacts[0].emails,
        vec!["carol@example.com".to_string()]
    );
    assert_eq!(second.removed, vec![grace.id.clone()]);
}
