//! Archiving a thread ("done") and bringing it back.

use email_e2e::{Inbox, Mail, Provider, Report, Stack};
use serde_json::{Value, json};

/// Archives or restores one thread and returns the HTTP status and body.
async fn set_archived(
    inbox: &Inbox,
    thread_id: &str,
    value: bool,
) -> Result<(u16, String), Report> {
    let response = inbox
        .patch(
            &format!("/email/threads/{thread_id}/archived"),
            Some(&json!({ "value": value })),
        )
        .await?;
    Ok((response.status, response.text.clone()))
}

/// The thread's id from its preview.
fn id_of(preview: &Value) -> String {
    preview["id"].as_str().unwrap_or_default().to_owned()
}

/// Waits until the thread is in (or out of) the inbox list.
async fn wait_for_inbox_state(inbox: &Inbox, thread_id: &str, listed: bool) -> Result<(), Report> {
    email_e2e::eventually(
        if listed {
            "the thread to be back in the inbox"
        } else {
            "the thread to leave the inbox"
        },
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            let previews = inbox.previews("inbox").await?;
            let found = previews.iter().any(|preview| preview["id"] == thread_id);
            Ok((found == listed).then_some(()))
        },
    )
    .await
}

/// A received thread that was archived, and whose archive the provider has
/// since reported back, can be restored to the inbox, at Macro and at the
/// provider.
///
/// When it fails: "undo done" answers an error or leaves the thread out of
/// the inbox once a sync has run after the archive.
async fn an_archived_thread_can_be_restored(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let delivered = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Contract draft",
        "Please review.",
    ))?;
    let thread_id = id_of(&inbox.wait_for_preview("inbox", "Contract draft").await?);

    assert_eq!(set_archived(&inbox, &thread_id, true).await?.0, 200);
    wait_for_inbox_state(&inbox, &thread_id, false).await?;
    inbox
        .wait_for_provider_message("the message to leave the provider's inbox", |message| {
            message.id == delivered.id && !message.in_inbox
        })
        .await?;
    // A later sync has brought the provider's view of the archive back.
    inbox.deliver(&Mail::new(
        "Alan <alan@example.com>",
        "Later mail",
        "After the archive.",
    ))?;
    inbox.wait_for_preview("inbox", "Later mail").await?;
    let archived = inbox.thread(&thread_id).await?;
    assert_eq!(archived["inbox_visible"], false);
    assert!(
        inbox
            .previews("all")
            .await?
            .iter()
            .any(|preview| preview["id"] == thread_id.as_str()),
        "an archived thread stays in All Mail"
    );

    let (status, body) = set_archived(&inbox, &thread_id, false).await?;
    assert_eq!(status, 200, "restoring answered: {body}");
    wait_for_inbox_state(&inbox, &thread_id, true).await?;
    inbox
        .wait_for_provider_message(
            "the message to be back in the provider's inbox",
            |message| message.id == delivered.id && message.in_inbox,
        )
        .await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_an_archived_thread_can_be_restored() -> Result<(), Report> {
    an_archived_thread_can_be_restored(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_an_archived_thread_can_be_restored() -> Result<(), Report> {
    an_archived_thread_can_be_restored(Provider::Outlook).await
}

/// A thread the user only ever sent has nothing to restore to the inbox: the
/// API says so for one thread, and in a batch it reports that thread as
/// failed while restoring the others.
///
/// When it fails: restoring puts the user's own sent mail in the inbox, or
/// one such thread in a selection fails the whole "undo done".
async fn a_thread_without_received_mail_is_not_restored(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    inbox
        .send(&json!({
            "subject": "Only sent",
            "to": [{ "email": "grace@example.com" }],
            "body_text": "No answer yet.",
        }))
        .await?;
    let sent_id = id_of(&inbox.wait_for_preview("sent", "Only sent").await?);
    inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Received",
        "Hello.",
    ))?;
    let received_id = id_of(&inbox.wait_for_preview("inbox", "Received").await?);
    assert_eq!(set_archived(&inbox, &received_id, true).await?.0, 200);
    wait_for_inbox_state(&inbox, &received_id, false).await?;

    let (status, body) = set_archived(&inbox, &sent_id, false).await?;
    assert_eq!(status, 409, "restoring a sent-only thread answered: {body}");
    assert!(body.contains("no received messages"), "{body}");

    let batch = inbox
        .patch(
            "/email/threads/archived",
            Some(&json!({ "thread_ids": [received_id, sent_id], "value": false })),
        )
        .await?
        .ok()?;
    assert_eq!(batch["updated_thread_ids"], json!([received_id]));
    assert_eq!(batch["failed_thread_ids"], json!([sent_id]));
    wait_for_inbox_state(&inbox, &received_id, true).await?;
    let sent_only = inbox.thread(&sent_id).await?;
    assert_eq!(sent_only["inbox_visible"], false);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_thread_without_received_mail_is_not_restored() -> Result<(), Report> {
    a_thread_without_received_mail_is_not_restored(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_thread_without_received_mail_is_not_restored() -> Result<(), Report> {
    a_thread_without_received_mail_is_not_restored(Provider::Outlook).await
}

/// Archiving the same thread twice at once (a double click, two tabs) is one
/// archive: both requests succeed and the thread can still be restored.
///
/// When it fails: the second request errors, or the thread ends up in a
/// state "undo done" cannot bring back.
async fn archiving_twice_is_one_archive(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let delivered = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Twice",
        "Click click.",
    ))?;
    let thread_id = id_of(&inbox.wait_for_preview("inbox", "Twice").await?);

    let (first, second) = tokio::join!(
        set_archived(&inbox, &thread_id, true),
        set_archived(&inbox, &thread_id, true)
    );
    assert_eq!((first?.0, second?.0), (200, 200));
    assert_eq!(set_archived(&inbox, &thread_id, true).await?.0, 200);
    wait_for_inbox_state(&inbox, &thread_id, false).await?;
    inbox
        .wait_for_provider_message("the message to leave the provider's inbox", |message| {
            message.id == delivered.id && !message.in_inbox
        })
        .await?;

    assert_eq!(set_archived(&inbox, &thread_id, false).await?.0, 200);
    wait_for_inbox_state(&inbox, &thread_id, true).await?;
    inbox
        .wait_for_provider_message(
            "the message to be back in the provider's inbox",
            |message| message.id == delivered.id && message.in_inbox,
        )
        .await?;
    let copies = inbox
        .provider_messages()?
        .into_iter()
        .filter(|message| message.subject == "Twice")
        .count();
    assert_eq!(copies, 1, "the provider still holds the message once");

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_archiving_twice_is_one_archive() -> Result<(), Report> {
    archiving_twice_is_one_archive(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_archiving_twice_is_one_archive() -> Result<(), Report> {
    archiving_twice_is_one_archive(Provider::Outlook).await
}

/// A thread whose only mail is in Trash or Spam opens by its id.
///
/// When it fails: a deleted or junk thread opened from a link or a search
/// result shows "not found".
async fn a_trashed_or_junk_thread_opens_by_id(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    for (subject, gmail_label, outlook_folder) in [
        ("Thrown away", "TRASH", "deleteditems"),
        ("Junk offer", "SPAM", "junkemail"),
    ] {
        match provider {
            Provider::Gmail => {
                stack.gmail().deliver(
                    inbox.email(),
                    &email_e2e::gmail_emulator::NewMessage {
                        from: Some("Mallory <mallory@example.net>".to_owned()),
                        subject: Some(subject.to_owned()),
                        text: Some("Body.".to_owned()),
                        labels: Some(vec![gmail_label.to_owned()]),
                        ..Default::default()
                    },
                )?;
            }
            Provider::Outlook => {
                stack.outlook().deliver(
                    inbox.email(),
                    &email_e2e::outlook_emulator::NewMessage {
                        from: Some("Mallory <mallory@example.net>".to_owned()),
                        subject: Some(subject.to_owned()),
                        text: Some("Body.".to_owned()),
                        folder: Some(outlook_folder.to_owned()),
                        ..Default::default()
                    },
                )?;
            }
        }
    }
    let trashed = id_of(&inbox.wait_for_preview("trash", "Thrown away").await?);
    let junk = id_of(&inbox.wait_for_preview("spam", "Junk offer").await?);

    for (thread_id, subject) in [(&trashed, "Thrown away"), (&junk, "Junk offer")] {
        let thread = inbox.thread(thread_id).await?;
        let messages = thread["messages"].as_array().cloned().unwrap_or_default();
        assert_eq!(messages.len(), 1, "{subject} opens with its message");
        assert_eq!(
            messages[0]["body_text"].as_str().map(str::trim),
            Some("Body.")
        );
        assert_eq!(thread["inbox_visible"], false);
    }
    assert!(inbox.previews("inbox").await?.is_empty());

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_trashed_or_junk_thread_opens_by_id() -> Result<(), Report> {
    a_trashed_or_junk_thread_opens_by_id(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_trashed_or_junk_thread_opens_by_id() -> Result<(), Report> {
    a_trashed_or_junk_thread_opens_by_id(Provider::Outlook).await
}
