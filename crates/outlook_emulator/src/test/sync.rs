use email_api_client::domain::models::{
    EmailApiError, FolderRole, MailboxChangePage, ProviderId, StreamPosition, StreamToken,
};
use email_api_client::domain::ports::{FolderChangeReader, MailboxContentReader};
use uuid::Uuid;

use super::{ADA, id, message_id, start, token};
use crate::{MessageChange, NewMessage};

fn seed_with_inbox(count: usize) -> String {
    let mut seed = format!("mailboxes:\n  - email: {ADA}\n    messages:\n");
    for index in 0..count {
        seed.push_str(&format!(
            "      - subject: Message {index:03}\n        text: Body {index}\n"
        ));
    }
    seed
}

/// Reads a delta round to its checkpoint.
async fn round(
    api: &impl FolderChangeReader,
    token: &email_api_client::domain::models::AccessToken,
    folder: &ProviderId,
    mut position: Option<StreamToken>,
) -> (Vec<MailboxChangePage>, StreamToken) {
    let mut pages = Vec::new();
    loop {
        let page = api
            .folder_changes(token, folder, position.as_ref())
            .await
            .unwrap();
        let next = page.position.clone();
        pages.push(page);
        match next {
            StreamPosition::Continue(next) => position = Some(next),
            StreamPosition::Checkpoint(checkpoint) => return (pages, checkpoint),
        }
    }
}

#[tokio::test]
async fn first_delta_round_pages_through_the_folder_with_skip_tokens() {
    let (emulator, api) = start(&seed_with_inbox(250)).await;
    let token = token(&emulator, ADA);

    let (pages, _checkpoint) = round(&api, &token, &id("inbox"), None).await;

    let sizes: Vec<usize> = pages.iter().map(|page| page.changed.len()).collect();
    assert_eq!(sizes, vec![100, 100, 50]);
    let mut seen: Vec<&ProviderId> = pages.iter().flat_map(|page| &page.changed).collect();
    seen.sort_by_key(|id| id.as_str().to_owned());
    seen.dedup();
    assert_eq!(seen.len(), 250);
    assert!(pages.iter().all(|page| page.removed.is_empty()));
}

#[tokio::test]
async fn later_rounds_report_only_what_changed_since_the_checkpoint() {
    let (emulator, api) = start(&seed_with_inbox(3)).await;
    let token = token(&emulator, ADA);
    let inbox = id("inbox");
    let (_, checkpoint) = round(&api, &token, &inbox, None).await;

    let (pages, checkpoint) = round(&api, &token, &inbox, Some(checkpoint)).await;
    assert_eq!(pages.len(), 1);
    assert!(pages[0].changed.is_empty() && pages[0].removed.is_empty());

    let read = message_id(&emulator, ADA, "Message 000");
    let moved = message_id(&emulator, ADA, "Message 001");
    let deleted = message_id(&emulator, ADA, "Message 002");
    let arrived = emulator
        .deliver(
            ADA,
            &NewMessage {
                subject: Some("New mail".into()),
                ..NewMessage::default()
            },
        )
        .unwrap();
    let mark_read = MessageChange {
        read: Some(true),
        ..MessageChange::default()
    };
    emulator
        .update_message(ADA, read.as_str(), &mark_read)
        .unwrap();
    let to_archive = MessageChange {
        folder: Some("archive".into()),
        ..MessageChange::default()
    };
    emulator
        .update_message(ADA, moved.as_str(), &to_archive)
        .unwrap();
    emulator.delete_message(ADA, deleted.as_str()).unwrap();

    let (pages, _) = round(&api, &token, &inbox, Some(checkpoint)).await;
    let mut changed: Vec<ProviderId> = pages.iter().flat_map(|p| p.changed.clone()).collect();
    let mut removed: Vec<ProviderId> = pages.iter().flat_map(|p| p.removed.clone()).collect();
    changed.sort_by_key(|id| id.as_str().to_owned());
    removed.sort_by_key(|id| id.as_str().to_owned());
    let mut expected_changed = vec![read, id(&arrived.id)];
    expected_changed.sort_by_key(|id| id.as_str().to_owned());
    let mut expected_removed = vec![moved.clone(), deleted];
    expected_removed.sort_by_key(|id| id.as_str().to_owned());
    assert_eq!(changed, expected_changed);
    assert_eq!(removed, expected_removed);

    // The moved message keeps its immutable id and shows up in Archive.
    let (pages, _) = round(&api, &token, &id("archive"), None).await;
    assert_eq!(pages[0].changed, vec![moved]);
}

#[tokio::test]
async fn an_expired_delta_token_is_an_outdated_cursor() {
    let (emulator, api) = start(&seed_with_inbox(2)).await;
    let token = token(&emulator, ADA);
    let inbox = id("inbox");
    let (_, checkpoint) = round(&api, &token, &inbox, None).await;

    emulator.expire_delta_tokens(ADA).unwrap();

    let error = api
        .folder_changes(&token, &inbox, Some(&checkpoint))
        .await
        .unwrap_err();
    assert!(matches!(error, EmailApiError::OutdatedCursor));
    // A fresh round works again.
    let (pages, _) = round(&api, &token, &inbox, None).await;
    assert_eq!(pages[0].changed.len(), 2);
}

#[tokio::test]
async fn a_delta_token_outlives_its_lifetime_only_until_the_clock_passes_it() {
    let seed = format!(
        "mailboxes:\n  - email: {ADA}\n    delta_token_lifetime_days: 7\n    messages:\n      - subject: One\n"
    );
    let (emulator, api) = start(&seed).await;
    let token = token(&emulator, ADA);
    let inbox = id("inbox");
    let (_, checkpoint) = round(&api, &token, &inbox, None).await;

    emulator.advance_clock(std::time::Duration::from_secs(8 * 86_400));

    let token = super::token(&emulator, ADA);
    let error = api
        .folder_changes(&token, &inbox, Some(&checkpoint))
        .await
        .unwrap_err();
    assert!(matches!(error, EmailApiError::OutdatedCursor));
}

#[tokio::test]
async fn folders_carry_their_roles_and_nested_children() {
    let seed = format!(
        "mailboxes:\n  - email: {ADA}\n    folders:\n      - name: Projects\n      - name: Apollo\n        parent: Projects\n"
    );
    let (emulator, api) = start(&seed).await;
    let token = token(&emulator, ADA);

    let folders = api.folders(&token).await.unwrap();

    let role = |name: &str| folders.iter().find(|f| f.name == name).unwrap().role;
    assert_eq!(role("Inbox"), FolderRole::Inbox);
    assert_eq!(role("Sent Items"), FolderRole::Sent);
    assert_eq!(role("Drafts"), FolderRole::Drafts);
    assert_eq!(role("Deleted Items"), FolderRole::Trash);
    assert_eq!(role("Junk Email"), FolderRole::Junk);
    assert_eq!(role("Archive"), FolderRole::Archive);
    assert_eq!(role("Projects"), FolderRole::Other);
    let projects = folders.iter().find(|f| f.name == "Projects").unwrap();
    let apollo = folders.iter().find(|f| f.name == "Apollo").unwrap();
    assert!(projects.has_children);
    assert_eq!(apollo.parent_id.as_ref(), Some(&projects.id));
}

#[tokio::test]
async fn a_message_reads_back_with_body_people_state_attachments_and_invitation() {
    let seed = format!(
        r#"
mailboxes:
  - email: {ADA}
    name: Ada Example
    messages:
      - from: Grace Example <grace@example.com>
        cc: Alan <alan@example.com>
        subject: Quarterly numbers
        html: "<p>The <b>Q3</b> numbers are ready.</p>"
        message_id: q3-1@example.com
        flagged: true
        categories: [Finance]
        other: true
        date: "2026-11-03T09:00:00Z"
        attachments:
          - filename: q3.csv
            mime_type: text/csv
            text: "a,b\n1,2\n"
      - from: Grace Example <grace@example.com>
        subject: Planning
        text: Let us plan.
        calendar: "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:plan-1\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
"#
    );
    let (emulator, api) = start(&seed).await;
    let token = token(&emulator, ADA);
    let folders = api.folders(&token).await.unwrap();
    let link_id = Uuid::now_v7();

    let numbers = message_id(&emulator, ADA, "Quarterly numbers");
    let read = api
        .message(&token, link_id, &numbers, &folders)
        .await
        .unwrap()
        .unwrap();
    let message = &read.content.message;
    assert_eq!(message.subject.as_deref(), Some("Quarterly numbers"));
    assert_eq!(message.global_id.as_deref(), Some("<q3-1@example.com>"));
    assert_eq!(message.from.as_ref().unwrap().email, "grace@example.com");
    assert_eq!(
        message.from.as_ref().unwrap().name.as_deref(),
        Some("Grace Example")
    );
    assert_eq!(message.to[0].email, ADA);
    assert_eq!(message.cc[0].email, "alan@example.com");
    assert!(
        message
            .body_html_sanitized
            .as_ref()
            .unwrap()
            .contains("<b>Q3</b>")
    );
    assert!(!message.is_read && message.is_starred && !message.is_sent && !message.is_draft);
    assert_eq!(
        message.sent_at.unwrap().to_rfc3339(),
        "2026-11-03T09:00:00+00:00"
    );
    assert!(read.state.in_inbox);
    assert_eq!(read.tags, vec!["Finance".to_string()]);
    assert!(read.version.is_some());
    assert_eq!(message.attachments.len(), 1);
    assert_eq!(message.attachments[0].filename.as_deref(), Some("q3.csv"));
    assert!(read.content.calendar_parts.is_empty());

    let attachment = id(message.attachments[0].provider_id.as_ref().unwrap());
    let bytes = api.attachment(&token, &numbers, &attachment).await.unwrap();
    assert_eq!(bytes, b"a,b\n1,2\n");

    let planning = message_id(&emulator, ADA, "Planning");
    let invitation = api
        .message(&token, link_id, &planning, &folders)
        .await
        .unwrap()
        .unwrap();
    assert!(!invitation.calendar_parts_unavailable);
    assert_eq!(invitation.content.calendar_parts.len(), 1);
    let part = invitation.content.calendar_parts[0]
        .inline_data
        .as_ref()
        .unwrap();
    assert!(String::from_utf8_lossy(part).contains("UID:plan-1"));

    let source = api.mime(&token, &numbers).await.unwrap();
    let source = String::from_utf8_lossy(&source);
    assert!(source.contains("Subject: Quarterly numbers"));
    assert!(source.contains("q3.csv"));

    let missing = api
        .message(&token, link_id, &id("AAMkADmissing"), &folders)
        .await
        .unwrap();
    assert!(missing.is_none());
}

#[tokio::test]
async fn recent_inbox_messages_are_newest_first_and_limited() {
    let seed = format!(
        r#"
mailboxes:
  - email: {ADA}
    messages:
      - {{ subject: Oldest, date: "2026-11-01T09:00:00Z" }}
      - {{ subject: Newest, date: "2026-11-03T09:00:00Z" }}
      - {{ subject: Middle, date: "2026-11-02T09:00:00Z" }}
      - {{ subject: Sent, folder: sentitems, date: "2026-11-04T09:00:00Z" }}
"#
    );
    let (emulator, api) = start(&seed).await;
    let token = token(&emulator, ADA);
    let folders = api.folders(&token).await.unwrap();

    let recent = api
        .recent_inbox_messages(&token, Uuid::now_v7(), 2, &folders)
        .await
        .unwrap();

    let subjects: Vec<_> = recent
        .iter()
        .map(|m| m.content.message.subject.clone().unwrap())
        .collect();
    assert_eq!(subjects, vec!["Newest".to_string(), "Middle".to_string()]);
}
