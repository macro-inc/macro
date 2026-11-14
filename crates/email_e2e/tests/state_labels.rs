//! Labels, stars and sender rules, and how they travel to the provider.

use email_e2e::gmail_emulator::{Fault, FaultError, Route, SeedLabel, SeedMailbox};
use email_e2e::{Inbox, Mail, Provider, Report, Stack};
use serde_json::{Value, json};

/// The thread's id from its preview.
fn id_of(preview: &Value) -> String {
    preview["id"].as_str().unwrap_or_default().to_owned()
}

/// The provider label ids on the thread's first message, as Macro has them.
fn first_message_labels(thread: &Value) -> Vec<String> {
    thread["messages"][0]["labels"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|label| label["provider_label_id"].as_str().map(str::to_owned))
        .collect()
}

/// Delivers one more mail and waits for it, so that every provider change
/// made before it has been synced.
async fn sync_barrier(inbox: &Inbox, subject: &str) -> Result<(), Report> {
    inbox.deliver(&Mail::new("Barrier <barrier@example.com>", subject, "."))?;
    inbox.wait_for_preview("all", subject).await?;
    Ok(())
}

/// An archive Macro has not yet delivered to Gmail survives a sync that
/// brings in another label change made at Gmail in the meantime.
///
/// When it fails: a thread the user marked done jumps back into the inbox
/// when anything else about it changes at Gmail while the write is pending.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_sync_keeps_an_archive_that_is_still_pending() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    stack.gmail().add_mailbox(&SeedMailbox {
        email: ada.email().to_owned(),
        labels: vec![SeedLabel {
            id: Some("Label_1".to_owned()),
            name: "Clients".to_owned(),
        }],
        ..Default::default()
    })?;
    let inbox = ada.link_gmail().await?;
    let delivered = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Pending archive",
        "Done soon.",
    ))?;
    let thread_id = id_of(&inbox.wait_for_preview("inbox", "Pending archive").await?);

    // Gmail refuses label writes for now, so the archive stays pending.
    let fault = stack.gmail().inject_fault(Fault {
        mailbox: Some(inbox.email().to_owned()),
        route: Some(Route::MessagesModify),
        error: Some(FaultError::Unavailable),
        ..Default::default()
    });
    inbox
        .patch(
            &format!("/email/threads/{thread_id}/archived"),
            Some(&json!({ "value": true })),
        )
        .await?
        .ok()?;

    // Meanwhile the user's other mail client files the message under a label.
    stack
        .gmail()
        .modify_labels(inbox.email(), &delivered.id, &["Label_1".to_owned()], &[])?;
    let thread = inbox
        .wait_for_thread(&thread_id, "the label added at Gmail", |thread| {
            first_message_labels(thread)
                .iter()
                .any(|label| label == "Label_1")
        })
        .await?;
    assert_eq!(
        thread["inbox_visible"], false,
        "the pending archive survives the sync"
    );
    assert!(
        !first_message_labels(&thread)
            .iter()
            .any(|label| label == "INBOX"),
        "the message keeps its pending removal from the inbox"
    );
    assert!(
        !inbox
            .previews("inbox")
            .await?
            .iter()
            .any(|preview| preview["id"] == thread_id.as_str())
    );

    // Once Gmail accepts writes again the archive arrives.
    stack.gmail().remove_fault(fault);
    inbox
        .wait_for_provider_message("the message to leave Gmail's inbox", |message| {
            message.id == delivered.id && !message.in_inbox
        })
        .await?;
    let at_gmail = inbox.provider_message(&delivered.id)?;
    assert!(at_gmail.is_some_and(|message| message.labels.iter().any(|label| label == "Label_1")));

    stack.finish().await
}

/// A star removed at Gmail is removed in Macro.
///
/// When it fails: a thread unstarred in another mail client stays starred,
/// and stays in the Starred list, in Macro.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: labels-starred-removed-flag-kept"]
async fn gmail_a_star_removed_at_gmail_is_removed_in_macro() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;
    let delivered = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Starred once",
        "Keep this.",
    ))?;
    let thread_id = id_of(&inbox.wait_for_preview("inbox", "Starred once").await?);

    inbox
        .patch(
            &format!("/email/threads/{thread_id}/state"),
            Some(&json!({ "field": "starred", "value": true })),
        )
        .await?
        .ok()?;
    inbox
        .wait_for_provider_message("the star to reach Gmail", |message| {
            message.id == delivered.id && message.starred
        })
        .await?;
    inbox.wait_for_preview("starred", "Starred once").await?;

    stack
        .gmail()
        .modify_labels(inbox.email(), &delivered.id, &[], &["STARRED".to_owned()])?;
    inbox
        .wait_for_thread(&thread_id, "the star's removal to be synced", |thread| {
            !first_message_labels(thread)
                .iter()
                .any(|label| label == "STARRED")
        })
        .await?;
    sync_barrier(&inbox, "After the unstar").await?;

    let thread = inbox.thread(&thread_id).await?;
    assert_eq!(thread["messages"][0]["is_starred"], false);
    assert!(
        !inbox
            .previews("starred")
            .await?
            .iter()
            .any(|preview| preview["id"] == thread_id.as_str()),
        "the thread has left the Starred list"
    );

    stack.finish().await
}

/// A star set in Macro reaches Gmail and the Starred list; unstarring in
/// Macro removes it from both.
///
/// When it fails: a star set in Macro is missing in Gmail, or a thread
/// unstarred in Macro stays starred there.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_star_set_in_macro_reaches_gmail() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;
    let second = inbox.deliver(&Mail::new(
        "Alan <alan@example.com>",
        "Star in Macro",
        "Two.",
    ))?;
    let second_id = id_of(&inbox.wait_for_preview("inbox", "Star in Macro").await?);

    let set_star = async |value: bool| -> Result<(), Report> {
        inbox
            .patch(
                &format!("/email/threads/{second_id}/state"),
                Some(&json!({ "field": "starred", "value": value })),
            )
            .await?
            .ok()?;
        Ok(())
    };
    set_star(true).await?;
    inbox
        .wait_for_provider_message("the star to reach Gmail", |message| {
            message.id == second.id && message.starred
        })
        .await?;
    inbox.wait_for_preview("starred", "Star in Macro").await?;
    set_star(false).await?;
    inbox
        .wait_for_provider_message("the star to leave Gmail", |message| {
            message.id == second.id && !message.starred
        })
        .await?;
    email_e2e::eventually(
        "the thread to leave the Starred list",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            let starred = inbox.previews("starred").await?;
            Ok(starred.is_empty().then_some(()))
        },
    )
    .await?;

    stack.finish().await
}

/// Creates a label in the inbox and returns its id.
async fn create_label(inbox: &Inbox, name: &str) -> Result<String, Report> {
    inbox
        .post("/email/labels", Some(&json!({ "label_name": name })))
        .await?
        .ok()?;
    let labels = inbox.get("/email/labels").await?.ok()?;
    let id = labels["labels"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|label| {
            label["name"] == name && label["linkId"] == inbox.link_id().to_string().as_str()
        })
        .and_then(|label| label["id"].as_str())
        .unwrap_or_default()
        .to_owned();
    Ok(id)
}

/// Filing a thread under a label the user made puts the label on the
/// message at Gmail and the thread in that label's list.
///
/// When it fails: "move to" does nothing, files under the wrong label, or
/// the label's list stays empty.
async fn filing_under_a_label(name: &str) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;
    let delivered = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "To be filed",
        "File me.",
    ))?;
    inbox.deliver(&Mail::new(
        "Alan <alan@example.com>",
        "Left alone",
        "Not me.",
    ))?;
    let thread_id = id_of(&inbox.wait_for_preview("inbox", "To be filed").await?);
    inbox.wait_for_preview("inbox", "Left alone").await?;

    let label_id = create_label(&inbox, name).await?;
    assert!(!label_id.is_empty(), "the new label is listed");
    let filed = inbox
        .patch(
            &format!("/email/threads/{thread_id}/labels"),
            Some(&json!({ "label_id": label_id, "value": true })),
        )
        .await?
        .ok()?;
    assert_eq!(filed["failed_ids"], json!([]));

    let labels = inbox.get("/email/labels").await?.ok()?;
    let provider_label = labels["labels"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|label| label["id"] == label_id.as_str())
        .and_then(|label| label["providerLabelId"].as_str())
        .unwrap_or_default()
        .to_owned();
    assert!(!provider_label.is_empty(), "Gmail has the label");
    inbox
        .wait_for_provider_message("the label to reach Gmail", |message| {
            message.id == delivered.id && message.labels.contains(&provider_label)
        })
        .await?;

    let view = format!("user:{}", urlencoding::encode(name));
    let listed = inbox.wait_for_preview(&view, "To be filed").await?;
    assert_eq!(listed["id"], thread_id.as_str());
    assert_eq!(
        inbox.previews(&view).await?.len(),
        1,
        "only the filed thread"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_filing_under_a_label() -> Result<(), Report> {
    filing_under_a_label("clients").await
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: labels-move-to-folder-wrong"]
async fn gmail_filing_under_a_label_with_capitals() -> Result<(), Report> {
    filing_under_a_label("Clients").await
}

/// A label belongs to one inbox: it cannot be put on another inbox's
/// thread, and each inbox lists only its own.
///
/// When it fails: with two inboxes, filing uses the first inbox's label on
/// the second inbox's mail, which Gmail refuses or misfiles.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_label_is_not_applied_across_inboxes() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let first = ada.link_gmail().await?;
    let second = ada.link(Provider::Gmail, "ada.work@example.com").await?;
    let delivered = first.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "In the first",
        "A.",
    ))?;
    second.deliver(&Mail::new("Alan <alan@example.com>", "In the second", "B."))?;
    let thread = first.wait_for_preview("inbox", "In the first").await?;
    let thread_id = id_of(&thread);
    let message_id = first.thread(&thread_id).await?["messages"][0]["db_id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();

    let first_label = create_label(&first, "projects").await?;
    let second_label = create_label(&second, "projects").await?;
    assert_ne!(first_label, second_label, "each inbox has its own label");

    let across = second
        .patch(
            &format!("/email/threads/{thread_id}/labels"),
            Some(&json!({ "label_id": second_label, "value": true })),
        )
        .await?;
    assert_eq!(across.status, 404, "{}", across.text);
    let across = first
        .patch(
            &format!("/email/threads/{thread_id}/labels"),
            Some(&json!({ "label_id": second_label, "value": true })),
        )
        .await?;
    assert_eq!(across.status, 404, "{}", across.text);
    let across = first
        .patch(
            "/email/messages/labels",
            Some(&json!({ "message_ids": [message_id], "label_id": second_label, "value": true })),
        )
        .await?;
    assert_eq!(across.status, 400, "{}", across.text);

    // The inbox's own label works, and lands in that inbox at Gmail only.
    first
        .patch(
            &format!("/email/threads/{thread_id}/labels"),
            Some(&json!({ "label_id": first_label, "value": true })),
        )
        .await?
        .ok()?;
    first
        .wait_for_provider_message("the label to reach the first mailbox", |message| {
            message.id == delivered.id
                && message
                    .labels
                    .iter()
                    .any(|label| label.starts_with("Label_"))
        })
        .await?;
    let others = second.provider_messages()?;
    assert!(!others.is_empty(), "the second mailbox has mail");
    assert!(
        others.iter().all(|message| !message
            .labels
            .iter()
            .any(|label| label.starts_with("Label_"))),
        "no label reached the second mailbox: {others:?}"
    );

    stack.finish().await
}

/// A star set at Gmail on mail Macro already has shows in Macro.
///
/// When it fails: a thread starred in another mail client is not starred,
/// and not in the Starred list, in Macro.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: labels-starred-removed-flag-kept"]
async fn gmail_a_star_set_at_gmail_shows_in_macro() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;
    let delivered = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Star at Gmail",
        "One.",
    ))?;
    let thread_id = id_of(&inbox.wait_for_preview("inbox", "Star at Gmail").await?);

    stack
        .gmail()
        .modify_labels(inbox.email(), &delivered.id, &["STARRED".to_owned()], &[])?;
    inbox
        .wait_for_thread(&thread_id, "the star to be synced", |thread| {
            first_message_labels(thread)
                .iter()
                .any(|label| label == "STARRED")
        })
        .await?;
    sync_barrier(&inbox, "After the star").await?;

    let thread = inbox.thread(&thread_id).await?;
    assert_eq!(thread["messages"][0]["is_starred"], true);
    assert!(
        inbox
            .previews("starred")
            .await?
            .iter()
            .any(|preview| preview["id"] == thread_id.as_str()),
        "the thread is in the Starred list"
    );

    stack.finish().await
}
