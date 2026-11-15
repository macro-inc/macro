//! Changing From on a draft: the draft follows the sender to the inbox they
//! chose, between providers through a transfer and between two Gmail inboxes
//! through a plain save.

#[expect(
    dead_code,
    reason = "the From scenarios use part of what the draft scenarios share"
)]
#[path = "send_support/drafts.rs"]
mod drafts;
#[path = "send_support/support.rs"]
mod support;

use drafts::{
    draft_previews, generation_of, id_of, refused, try_save, wait_for_no_draft_preview,
    wait_until_in_mailbox,
};
use email_e2e::{DEFAULT_TIMEOUT, Inbox, Provider, Report, Stack, eventually};
use serde_json::{Value, json};
use support::{message_in_thread, provider_copies, wait_for_no_provider_draft, wait_for_wire};
use uuid::Uuid;

/// Moves a draft to another inbox of the same user, as changing From does.
/// A source the draft worker is still writing answers 409; the composer
/// asks again with the same operation id, and so does this.
async fn transfer(
    source: &Inbox,
    draft_id: &str,
    generation: i64,
    destination: &Inbox,
) -> Result<Value, Report> {
    let request = json!({
        "draft_generation": generation,
        "operation_id": Uuid::now_v7().to_string(),
        "destination_link_id": destination.link_id().to_string(),
    });
    eventually(
        "the draft to move to the other inbox",
        DEFAULT_TIMEOUT,
        async || {
            let answer = source
                .post(
                    &format!("/email/drafts/{draft_id}/transfer"),
                    Some(&request),
                )
                .await?;
            if answer.status == 409 {
                return Ok(None);
            }
            Ok(Some(answer.ok()?))
        },
    )
    .await
}

/// What every From switch must leave behind: the draft in the new inbox
/// only, editable there, the old id dead, and the message sent from the new
/// address.
async fn assert_draft_lives_in(
    stack: &Stack,
    old: &Inbox,
    old_draft: &Value,
    new: &Inbox,
    new_thread: &str,
    new_id: &str,
    recipient: &Inbox,
) -> Result<(), Report> {
    let subject = old_draft["subject"].as_str().unwrap_or_default();
    let moved = message_in_thread(new, new_thread, new_id).await?;
    assert_eq!(moved["is_draft"], true, "the draft did not arrive: {moved}");
    assert_eq!(moved["link_id"], new.link_id().to_string());
    assert_eq!(moved["body_text"], old_draft["body_text"]);
    assert_eq!(moved["to"][0]["email"], recipient.email());

    // The composer keeps typing in the new inbox.
    let edited = new
        .save_draft(&json!({
            "db_id": new_id,
            "draft_generation": generation_of(&moved),
            "subject": subject,
            "to": [{ "email": recipient.email() }],
            "body_text": "Typed after the switch.",
        }))
        .await?;
    assert_eq!(id_of(&edited), new_id, "the next save made another draft");
    wait_until_in_mailbox(new, new_id, subject).await?;

    // Nothing of it is left in the old inbox, in Macro or at the provider.
    wait_for_no_draft_preview(old, subject).await?;
    wait_for_no_provider_draft(old).await?;
    let old_thread = old_draft["thread_db_id"].as_str().unwrap_or_default();
    let old_id = id_of(old_draft);
    if old_id != new_id {
        assert_eq!(
            message_in_thread(old, old_thread, &old_id).await?,
            Value::Null,
            "the old inbox still shows the moved draft"
        );
        let late = try_save(
            old,
            &json!({
                "db_id": old_id,
                "draft_generation": generation_of(old_draft),
                "subject": subject,
                "to": [{ "email": recipient.email() }],
                "body_text": "A late save from before the switch.",
            }),
        )
        .await?;
        assert!(
            refused(&late),
            "a late save brought the old draft back: {} {}",
            late.status,
            late.text
        );
    }
    let listed = draft_previews(new, subject).await?;
    assert_eq!(listed.len(), 1, "one draft in the new inbox: {listed:?}");

    new.send(&json!({
        "db_id": new_id,
        "draft_generation": generation_of(&edited),
        "subject": subject,
        "to": [{ "email": recipient.email() }],
        "body_text": "Typed after the switch.",
    }))
    .await?;
    let (received, _) = wait_for_wire(stack, recipient, subject).await?;
    assert!(
        received
            .from
            .as_deref()
            .is_some_and(|from| from.contains(new.email())),
        "the message was not sent from the inbox chosen in From: {received:?}"
    );
    new.wait_for_preview("sent", subject).await?;
    assert_eq!(provider_copies(recipient, subject)?.len(), 1);
    assert!(
        provider_copies(old, subject)?.is_empty(),
        "the old inbox sent the message too"
    );
    wait_for_no_provider_draft(new).await?;
    wait_for_no_draft_preview(new, subject).await?;
    wait_for_no_draft_preview(old, subject).await
}

/// Changing From moves a saved draft between inboxes of different
/// providers: it becomes a new draft in the destination, the source keeps
/// nothing, and the message goes out from the destination. If this fails,
/// the next save conflicts, two drafts exist, or the mail leaves from the
/// inbox the user switched away from.
async fn draft_moves_to_the_inbox_chosen_in_from(
    source: Provider,
    destination: Provider,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let old = ada.link(source, ada.email()).await?;
    let new = ada.link(destination, "ada.work@example.com").await?;
    let recipient = grace.link(destination, grace.email()).await?;

    let draft = old
        .save_draft(&json!({
            "subject": "Offsite",
            "to": [{ "email": grace.email() }],
            "body_text": "Shall we?",
        }))
        .await?;
    let id = id_of(&draft);
    wait_until_in_mailbox(&old, &id, "Offsite").await?;

    let moved = transfer(&old, &id, generation_of(&draft), &new).await?;
    let new_id = moved["message_id"].as_str().unwrap_or_default().to_owned();
    let new_thread = moved["thread_id"].as_str().unwrap_or_default().to_owned();
    assert_eq!(moved["source_id"], id.as_str());
    assert_ne!(
        new_id, id,
        "the moved draft kept the id delayed writes still name"
    );

    assert_draft_lives_in(&stack, &old, &draft, &new, &new_thread, &new_id, &recipient).await?;
    stack.finish().await
}

/// Between two Gmail inboxes a save under the other inbox is enough to move
/// the draft: it keeps its id, leaves the first inbox and is sent from the
/// second. If this fails, the save after a From switch answers "not found"
/// and the draft is stuck in the inbox it was started in.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_draft_follows_a_from_switch_to_another_gmail_inbox() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let old = ada.link_gmail().await?;
    let new = ada.link(Provider::Gmail, "ada.work@example.com").await?;
    let recipient = grace.link_gmail().await?;

    let content = json!({
        "subject": "Offsite",
        "to": [{ "email": grace.email() }],
        "body_text": "Shall we?",
    });
    let draft = old.save_draft(&content).await?;
    let id = id_of(&draft);

    let mut switched = content.clone();
    switched["db_id"] = json!(id);
    switched["draft_generation"] = json!(generation_of(&draft));
    let moved = new.save_draft(&switched).await?;
    assert_eq!(id_of(&moved), id, "the draft changed its id");
    assert_eq!(moved["link_id"], new.link_id().to_string());
    let new_thread = moved["thread_db_id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();

    assert_draft_lives_in(&stack, &old, &draft, &new, &new_thread, &id, &recipient).await?;
    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_draft_moves_to_the_outlook_inbox_chosen_in_from() -> Result<(), Report> {
    draft_moves_to_the_inbox_chosen_in_from(Provider::Gmail, Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_draft_moves_to_the_gmail_inbox_chosen_in_from() -> Result<(), Report> {
    draft_moves_to_the_inbox_chosen_in_from(Provider::Outlook, Provider::Gmail).await
}
